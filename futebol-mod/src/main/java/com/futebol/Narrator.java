package com.futebol;

import net.minecraft.core.Holder;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundSoundPacket;
import net.minecraft.network.protocol.game.ClientboundStopSoundPacket;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundSource;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * Narrador e comentarista. As frases são montadas a partir de clipes de voz (TTS) que vão dentro do mod
 * (assets/futebol/sounds/narrador). Sem os clipes (ex.: servidor com cliente vanilla), só funciona a legenda.
 */
public final class Narrator {
    public static final int FILLER = 0, SKILL = 1, FOUL = 2, SHOT = 3, CARD = 4, GOAL = 5;

    record Clip(String id, int ms, String text) {}
    private record Utt(int prio, int expires, List<Clip> clips, List<String> ids) {}

    private static final Map<String, Clip> CLIPS = new HashMap<>();
    private static final Map<String, List<String>> VARIANTS = new HashMap<>();
    private static final Map<String, Holder<SoundEvent>> EVENTS = new HashMap<>();
    private static boolean loaded;

    public static void load() {
        if (loaded) return;
        loaded = true;
        try (InputStream in = Narrator.class.getResourceAsStream("/futebol/narrador/manifest.txt")) {
            if (in == null) { FutebolMod.LOG.warn("Narração não encontrada (manifest.txt)."); return; }
            BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String l;
            while ((l = r.readLine()) != null) {
                String[] f = l.split("\\|", 3);
                if (f.length < 3) continue;
                Clip c = new Clip(f[0], Integer.parseInt(f[1]), f[2]);
                CLIPS.put(c.id(), c);
                int u = c.id().lastIndexOf('_');
                if (u > 0 && c.id().substring(u + 1).matches("\\d+") && !c.id().startsWith("n_")) VARIANTS.computeIfAbsent(c.id().substring(0, u), k -> new ArrayList<>()).add(c.id());
                EVENTS.put(c.id(), Holder.direct(SoundEvent.createVariableRangeEvent(Identifier.fromNamespaceAndPath("futebol", "narrador." + c.id()))));
            }
            FutebolMod.LOG.info("Narrador: {} clipes de voz", CLIPS.size());
        } catch (Exception e) { FutebolMod.LOG.error("Erro lendo a narração", e); }
    }

    public static boolean available() { return !CLIPS.isEmpty(); }

    private final Match m;
    private final Random rnd = new Random();
    private final LinkedList<Utt> queue = new LinkedList<>();
    private Utt cur; private int curStart; private int[] due; private int curEnd, nextOk, now;
    public boolean on = true, captions = false;
    public float volume = 1.0f;
    private final Map<String, Integer> cooldown = new HashMap<>();

    public Narrator(Match m) { this.m = m; load(); }

    // ---------------------------------------------------------------- montagem de frases

    /** Resolve uma parte: id exato (p_..., t_..., n_...) ou grupo de variantes ("gol_grito"). */
    private String resolve(String part) {
        if (CLIPS.containsKey(part)) return part;
        List<String> v = VARIANTS.get(part);
        return v == null || v.isEmpty() ? null : v.get(rnd.nextInt(v.size()));
    }

    public static String P(FPlayer p) { return "p_" + Roster.ATUAL[p.team].id() + "_" + p.def.num(); }
    public static String T(int team) { return "t_" + Roster.ATUAL[team].id(); }
    public static String NUM(int n) { return "n_" + Math.max(0, Math.min(99, n)); }

    /** Fala (se o gancho não estiver em recarga). */
    public void say(String key, int cdTicks, int prio, String... parts) {
        if (!on) return;
        if (cdTicks > 0) {
            int until = cooldown.getOrDefault(key, 0);
            if (now < until) return;
            cooldown.put(key, now + cdTicks);
        }
        List<Clip> clips = new ArrayList<>(); List<String> ids = new ArrayList<>();
        for (String p : parts) {
            String id = resolve(p);
            if (id == null && p.startsWith("p_")) id = resolve(NUM(Integer.parseInt(p.substring(p.lastIndexOf('_') + 1))));   // sem o nome: usa o número
            if (id == null) continue;
            clips.add(CLIPS.get(id)); ids.add(id);
        }
        if (clips.isEmpty() && !captions) return;
        Utt u = new Utt(prio, now + 20 * (prio >= GOAL ? 30 : prio >= SHOT ? 9 : prio >= FOUL ? 6 : 4), clips, ids);
        if (cur != null && prio > cur.prio() + (prio >= GOAL ? 0 : 1)) interrupt();
        if (prio >= GOAL) queue.addFirst(u);
        else { queue.add(u); while (queue.size() > 4) { Utt worst = queue.get(0); for (Utt q : queue) if (q.prio() < worst.prio()) worst = q; queue.remove(worst); } }
    }

    public void say(int prio, String... parts) { say("", 0, prio, parts); }

    private void interrupt() {
        for (ServerPlayer pl : m.level.players()) pl.connection.send(new ClientboundStopSoundPacket(null, SoundSource.VOICE));
        cur = null;
    }

    // ---------------------------------------------------------------- tick

    public void tick() {
        now++;
        if (cur != null) {
            while (curStart < due.length && now >= due[curStart]) { play(cur.ids().get(curStart)); curStart++; }
            if (now >= curEnd) { cur = null; nextOk = now + 14; }
        }
        if (cur == null && now >= nextOk && !queue.isEmpty()) {
            Utt best = null;
            for (Utt u : queue) if (u.expires() >= now && (best == null || u.prio() > best.prio())) best = u;
            queue.removeIf(u -> u.expires() < now);
            if (best != null) { queue.remove(best); start(best); }
        }
    }

    private void start(Utt u) {
        cur = u; curStart = 0;
        due = new int[u.clips().size()];
        int t = now;
        for (int i = 0; i < due.length; i++) { due[i] = t; t += (int) Math.ceil(u.clips().get(i).ms() / 50.0) + 2; }
        curEnd = t + 4;
        if (captions && !u.clips().isEmpty() || captions) {
            StringBuilder sb = new StringBuilder();
            for (Clip c : u.clips()) sb.append(c.text()).append(' ');
            Component msg = Component.literal("§b🎙 §f" + sb.toString().strip());
            for (ServerPlayer pl : m.level.players()) pl.sendSystemMessage(msg, true);
        }
    }

    private void play(String id) {
        Holder<SoundEvent> ev = EVENTS.get(id);
        if (ev == null) return;
        for (ServerPlayer pl : m.level.players())
            pl.connection.send(new ClientboundSoundPacket(ev, SoundSource.VOICE, pl.getX(), pl.getY(), pl.getZ(), volume, 1.0f, rnd.nextLong()));
    }

    // ---------------------------------------------------------------- lances

    private int minute() { return Math.max(1, (m.half == 1 ? 0 : 45) + (int) (45.0 * m.clock / Math.max(1, m.halfLen))); }

    private boolean chance(double p) { return rnd.nextDouble() < p; }

    public void intro() { say(GOAL, "intro_a", T(0), "intro_b", T(1), "intro_c"); }
    public void kickoff(boolean second) { say(SHOT, second ? "inicio_2t" : "inicio"); }

    public void goal(FPlayer scorer, int team, boolean own) {
        int[] s = m.score;
        String ctx = null;
        int me = s[team], other = s[1 - team];
        if (me == 1 && other == 0) ctx = "gol_abre";
        else if (me == other) ctx = "gol_empata";
        else if (me == other + 1 && other > 0) ctx = "gol_vira";
        else if (me > other + 1) ctx = "gol_amplia";
        else if (me < other) ctx = "gol_diminui";
        List<String> p = new ArrayList<>();
        if (own) { p.add("gol_contra"); p.add(P(scorer)); }
        else { p.add("gol_grito"); p.add(P(scorer)); p.add(chance(0.5) ? "gol_pos" : (ctx == null ? "gol_pos" : ctx)); }
        int min = minute();
        p.add("min_pre"); p.add(NUM(min)); p.add(min == 1 ? "min_pos_2" : "min_pos_1");
        p.add(T(0)); p.add(NUM(s[0])); p.add("a_1"); p.add(NUM(s[1])); p.add(T(1));
        say(GOAL, p.toArray(new String[0]));
        if (chance(0.5)) say(FOUL, "com_gol");
    }

    public void save(FPlayer gk) {
        if (chance(0.5)) say("save", 80, SHOT, "defesa_de", P(gk));
        else say("save", 80, SHOT, "defesa");
        if (chance(0.3)) say(FOUL, "com_defesa");
    }

    public void shot(FPlayer k) { say("shot", 140, SHOT, P(k), "chute"); }
    public void wide(FPlayer k) { say("wide", 100, SHOT, "fora"); }

    public void foul(FPlayer fouler) {
        say("foul", 160, FOUL, "falta", P(fouler));
        if (chance(0.3)) say(FILLER, "com_falta");
    }

    public void freeKick(FPlayer taker) { say("fk", 200, FOUL, "falta_perigosa", P(taker)); }
    public void corner(int team) { say("corner", 120, FOUL, chance(0.5) ? "escanteio_1" : "escanteio_2", chance(0.5) ? T(team) : ""); }
    public void throwIn(int team) { if (chance(0.35)) say("lateral", 300, FILLER, "lateral_1", T(team)); }
    public void goalKick() { if (chance(0.3)) say("tiro", 400, FILLER, "tiro_meta_1"); }
    public void offside(FPlayer p) { say("imp", 100, FOUL, "impedimento"); if (chance(0.25)) say(FILLER, "com_imped_1"); }
    public void penalty(FPlayer taker) { say("pen", 0, CARD, "penalti_1", "penalti_cobra", P(taker)); if (chance(0.5)) say(FILLER, "com_penalti_1"); }
    public void card(FPlayer p, boolean red) {
        if (red) say(CARD, "vermelho", P(p), "vermelho_2");
        else say(CARD, "amarelo", P(p));
        if (chance(0.4)) say(FILLER, "com_cartao_1");
    }

    public void skill(FPlayer p, int type) {
        String[] k = {"finta_1", "pedalada_1", "elastico_1", "chapeu_1", "caneta_1"};
        say("skill", 400, SKILL, k[Math.max(0, Math.min(4, type))], P(p));
        if (chance(0.3)) say(FILLER, "com_drible");
    }

    public void through(FPlayer r) { say("through", 400, SKILL, "enfiada_1", P(r)); }
    public void cross() { say("cross", 400, SKILL, "cruz"); }
    public void switchPlay() { say("sw", 600, FILLER, "inversao_1"); }
    public void halftime() { say(CARD, "fim_1t", T(0), NUM(m.score[0]), "a_1", NUM(m.score[1]), T(1)); say(FILLER, "com_intervalo_1"); }
    public void fulltime() {
        int a = m.score[0], b = m.score[1];
        if (a == b) say(GOAL, "fim_jogo", "empate_fim");
        else say(GOAL, "fim_jogo", "vitoria", T(a > b ? 0 : 1));
        say(CARD, T(0), NUM(a), "a_1", NUM(b), T(1));
    }
    public void replay() { say(CARD, "replay"); }
    public void filler(FPlayer carrier) {
        if (carrier == null || carrier.isGK()) return;
        say("filler", 260, FILLER, P(carrier), "fil");
    }
    public void analyst(String key) { say("an_" + key, 700, FILLER, key); }
}
