package com.futebol;

import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.CustomData;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;

/** Campeonatos: pontos corridos (liga) e mata-mata (copa). Seu jogo é jogado ao vivo; os outros são simulados pelas notas. */
public final class Tournament {
    public record Fixture(Club home, Club away) {}
    public static final class Row { public Club club; public int p, j, v, e, d, gp, gc; }

    public static Tournament atual;

    public final String nome;
    public final boolean copa;
    public final Club user;
    final Random rnd = new Random();
    final List<Club> clubs;
    final List<Row> table = new ArrayList<>();
    final List<List<Fixture>> rounds = new ArrayList<>();
    int round;                         // rodada atual (0-based)
    List<Club> alive;                  // copa
    Fixture userFixture;
    boolean finished;

    public static final String[] PRESETS = {"premier", "brasileirao", "champions"};

    public Tournament(String nome, boolean copa, List<Club> clubs, Club user, boolean doubleRound) {
        this.nome = nome; this.copa = copa; this.clubs = clubs; this.user = user;
        for (Club c : clubs) { Row r = new Row(); r.club = c; table.add(r); }
        if (copa) { alive = new ArrayList<>(clubs); Collections.shuffle(alive, rnd); makeCupRound(); }
        else makeLeague(doubleRound);
        pickUserFixture();
    }

    public static Tournament preset(String id, Club user) {
        return switch (id) {
            case "premier" -> new Tournament("Premier League", false, load("arsenal", "liverpool", "mancity", "chelsea", "manutd", "tottenham", "newcastle", "astonvilla"), user, false);
            case "brasileirao" -> new Tournament("Brasileirão", false, load("cruzeiro", "atleticomg", "flamengo", "palmeiras"), user, true);
            case "champions" -> new Tournament("Liga dos Campeões", true, load("barcelona", "realmadrid", "psg", "mancity", "bayern", "dortmund", "arsenal", "liverpool",
                "chelsea", "manutd", "tottenham", "newcastle", "astonvilla", "flamengo", "palmeiras", "cruzeiro"), user, false);
            default -> null;
        };
    }

    static List<Club> load(String... ids) {
        List<Club> l = new ArrayList<>();
        for (String i : ids) { Club c = Clubs.get(i); if (c != null) l.add(c); }
        return l;
    }

    boolean has(Club c) { return clubs.contains(c); }

    // ---------------------------------------------------------------- calendário

    void makeLeague(boolean dbl) {
        List<Club> l = new ArrayList<>(clubs);
        int n = l.size();
        List<List<Fixture>> first = new ArrayList<>();
        for (int r = 0; r < n - 1; r++) {
            List<Fixture> fx = new ArrayList<>();
            for (int i = 0; i < n / 2; i++) {
                Club a = l.get(i), b = l.get(n - 1 - i);
                fx.add(r % 2 == 0 ? new Fixture(a, b) : new Fixture(b, a));
            }
            first.add(fx);
            l.add(1, l.remove(n - 1));
        }
        rounds.addAll(first);
        if (dbl) for (List<Fixture> fx : first) { List<Fixture> inv = new ArrayList<>(); for (Fixture f : fx) inv.add(new Fixture(f.away(), f.home())); rounds.add(inv); }
    }

    void makeCupRound() {
        List<Fixture> fx = new ArrayList<>();
        for (int i = 0; i + 1 < alive.size(); i += 2) fx.add(new Fixture(alive.get(i), alive.get(i + 1)));
        rounds.add(fx);
    }

    String roundName() {
        if (!copa) return "Rodada " + (round + 1) + "/" + rounds.size();
        int n = rounds.get(round).size() * 2;
        return n == 2 ? "Final" : n == 4 ? "Semifinal" : n == 8 ? "Quartas de final" : n == 16 ? "Oitavas de final" : "Fase de " + n;
    }

    void pickUserFixture() {
        userFixture = null;
        if (finished) return;
        for (Fixture f : rounds.get(round)) if (f.home() == user || f.away() == user) userFixture = f;
    }

    public Fixture next() { return userFixture; }

    // ---------------------------------------------------------------- simulação

    static double att(Club c) { double s = 0; int n = 0; for (Roster.Def d : c.defs()) if (d.pos().linha >= 2) { s += d.st().overall(d.pos()); n++; } return s / Math.max(1, n); }
    static double def(Club c) { double s = 0; int n = 0; for (Roster.Def d : c.defs()) if (d.pos().linha <= 1 || d.pos() == Pos.DM) { s += d.st().overall(d.pos()); n++; } return s / Math.max(1, n); }

    int poisson(double l) { double L = Math.exp(-l), p = 1; int k = 0; do { k++; p *= rnd.nextDouble(); } while (p > L); return k - 1; }

    int[] simulate(Club h, Club a) {
        double lh = 1.35 * Math.exp((att(h) - def(a)) / 20.0) * 1.08, la = 1.2 * Math.exp((att(a) - def(h)) / 20.0);
        return new int[]{poisson(Math.min(lh, 4.5)), poisson(Math.min(la, 4.5))};
    }

    void record(Club h, Club a, int gh, int ga) {
        Row rh = row(h), ra = row(a);
        rh.j++; ra.j++; rh.gp += gh; rh.gc += ga; ra.gp += ga; ra.gc += gh;
        if (gh > ga) { rh.v++; rh.p += 3; ra.d++; } else if (gh < ga) { ra.v++; ra.p += 3; rh.d++; } else { rh.e++; ra.e++; rh.p++; ra.p++; }
    }

    Row row(Club c) { for (Row r : table) if (r.club == c) return r; return null; }

    // ---------------------------------------------------------------- fluxo

    /** Chamado quando a partida ao vivo termina. */
    public void liveFinished(ServerLevel level, int gh, int ga) {
        Fixture uf = userFixture;
        List<String> out = new ArrayList<>();
        List<Club> winners = new ArrayList<>();
        for (Fixture f : rounds.get(round)) {
            int[] sc; String extra = "";
            if (f == uf) sc = new int[]{gh, ga}; else sc = simulate(f.home(), f.away());
            Club w = null;
            if (copa) {
                if (sc[0] == sc[1]) {
                    double ph = 0.5 + (ovr(f.home()) - ovr(f.away())) * 0.01;
                    boolean hw = rnd.nextDouble() < ph;
                    int a = 3 + rnd.nextInt(3), b = Math.max(0, a - 1 - rnd.nextInt(2));
                    extra = " §7(pên. " + (hw ? a + "-" + b : b + "-" + a) + ")";
                    w = hw ? f.home() : f.away();
                } else w = sc[0] > sc[1] ? f.home() : f.away();
                winners.add(w);
            } else record(f.home(), f.away(), sc[0], sc[1]);
            out.add((f == uf ? "§e▶ " : "§7  ") + "§f" + f.home().sigla() + " §e" + sc[0] + " x " + sc[1] + " §f" + f.away().sigla() + extra);
        }
        broadcast(level, "§6§l" + nome + " — " + roundName() + " (resultados)");
        out.forEach(l -> broadcast(level, l));
        round++;
        if (copa) {
            alive = winners;
            if (alive.size() == 1) { finish(level, alive.get(0)); return; }
            if (!alive.contains(user)) {                       // eliminado: simula o resto
                broadcast(level, "§c❌ Seu clube foi eliminado. O restante do torneio será simulado.");
                while (alive.size() > 1) {
                    List<Club> nx = new ArrayList<>();
                    for (int i = 0; i + 1 < alive.size(); i += 2) { int[] s = simulate(alive.get(i), alive.get(i + 1)); nx.add(s[0] > s[1] ? alive.get(i) : s[0] < s[1] ? alive.get(i + 1) : (rnd.nextBoolean() ? alive.get(i) : alive.get(i + 1))); }
                    alive = nx;
                }
                finish(level, alive.get(0)); return;
            }
            makeCupRound();
        } else if (round >= rounds.size()) { finish(level, sorted().get(0).club); return; }
        pickUserFixture();
        if (!copa) broadcast(level, tabela());
        broadcast(level, "§aPróximo jogo: §f" + userFixture.home().nome() + " x " + userFixture.away().nome() + " §7(" + roundName() + "). Use §e/futebol campeonato jogar");
        updateBoard();
    }

    static double ovr(Club c) { return (att(c) + def(c)) / 2; }

    void finish(ServerLevel level, Club champ) {
        finished = true;
        broadcast(level, "§6§l🏆 " + champ.nome().toUpperCase() + " é o campeão da " + nome + "!");
        if (!copa) broadcast(level, tabela());
        if (champ == user) {
            for (ServerPlayer pl : level.players()) {
                ItemStack t = new ItemStack(Items.GOLDEN_APPLE);
                t.set(DataComponents.CUSTOM_NAME, Component.literal("§6§l🏆 Troféu — " + nome + " (" + champ.nome() + ")"));
                t.set(DataComponents.ENCHANTMENT_GLINT_OVERRIDE, true);
                CompoundTag tag = new CompoundTag(); tag.putBoolean("futebol_trofeu", true);
                t.set(DataComponents.CUSTOM_DATA, CustomData.of(tag));
                pl.getInventory().add(t);
            }
        }
        updateBoard();
    }

    List<Row> sorted() {
        List<Row> l = new ArrayList<>(table);
        l.sort((a, b) -> a.p != b.p ? b.p - a.p : (b.gp - b.gc) != (a.gp - a.gc) ? (b.gp - b.gc) - (a.gp - a.gc) : b.gp - a.gp);
        return l;
    }

    public String tabela() {
        StringBuilder sb = new StringBuilder("§6§l" + nome + "\n§7 #  Clube        P  J  V  E  D  SG\n");
        int i = 1;
        for (Row r : sorted()) {
            sb.append(String.format("§f%2d §%s%-4s §e%3d §7%2d %2d %2d %2d %+3d\n", i++, r.club == user ? "a" : "f", r.club.sigla(), r.p, r.j, r.v, r.e, r.d, r.gp - r.gc));
        }
        return sb.toString().stripTrailing();
    }

    public String resumo() {
        if (finished) return "Encerrado";
        if (copa) {
            StringBuilder sb = new StringBuilder(roundName() + ": ");
            for (Fixture f : rounds.get(round)) sb.append(f.home().sigla()).append("x").append(f.away().sigla()).append("  ");
            return sb.toString();
        }
        StringBuilder sb = new StringBuilder(roundName() + "  ");
        int i = 1;
        for (Row r : sorted()) { if (i > 4) break; sb.append(i++).append("º ").append(r.club.sigla()).append(" ").append(r.p).append("  "); }
        return sb.toString();
    }

    void updateBoard() { if (FutebolMod.match != null) FutebolMod.match.boardInfo = nome + " · " + resumo(); }

    static void broadcast(ServerLevel level, String s) { for (ServerPlayer pl : level.players()) pl.sendSystemMessage(Component.literal(s)); }

    public static void broadcastTo(ServerLevel level, String s) { broadcast(level, s); }

    public boolean isFinished() { return finished; }
}
