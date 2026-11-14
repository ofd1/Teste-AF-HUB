package com.futebol;

import net.minecraft.ChatFormatting;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.Style;
import net.minecraft.network.protocol.game.ClientboundSetSubtitleTextPacket;
import net.minecraft.network.protocol.game.ClientboundSetTitleTextPacket;
import net.minecraft.network.protocol.game.ClientboundSetTitlesAnimationPacket;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.monster.cubemob.SulfurCube;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.DyedItemColor;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/** O jogo: física da bola, regras, reposições e a IA dos 22 jogadores. */
public final class Match {
    public enum St { IDLE, INTRO, SETPIECE, PLAYING, GOAL, HALFTIME, FULLTIME, REPLAY }
    public enum SP { KICKOFF, THROW_IN, CORNER, GOAL_KICK, FREE_KICK, PENALTY }

    static final double DG = 0.965, DA = 0.996;   // atrito da bola no chão / no ar (por tick)

    public final ServerLevel level;
    public final Pitch pitch;
    public final FPlayer[][] teams = new FPlayer[2][];
    public final List<FPlayer> all = new ArrayList<>();
    public SulfurCube ball;
    public Crowd crowd;
    public Cameras cameras;
    public Narrator nar;
    public Referee referee;
    public java.util.function.Consumer<Match> onFinish;
    public Screens screens;
    public final int[] attackDir = {1, -1};
    public final int[] score = new int[2];
    public St st = St.IDLE;
    public int half = 1;
    public int halfLen = 20 * 240;
    public int clock;
    final Random rnd = new Random();
    int stTicks, tickCount;

    // bola
    FPlayer carrier, lastToucher, passTarget;
    int lastTouchTeam = -1, passTtl;
    Vec3 ballVelSet = Vec3.ZERO;
    final Vec3[] traj = new Vec3[50];
    boolean ballPinned;
    double spin;                      // efeito: rotação (rad/tick) da direção horizontal da bola no ar
    int skillMsgCd;
    final int[] trans = new int[2];   // >0: transição ofensiva (contra-ataque)
    final int[] counterPress = new int[2];
    int lastCarrierTeam = -1;
    Vec3 pinPos;

    // reposição
    SP sp = SP.KICKOFF;
    int spTeam, spTicks;
    Vec3 spSpot = Vec3.ZERO;
    FPlayer spTaker;
    int kickoffTeam;
    int lastEventTeam = -1;
    java.util.Set<FPlayer> offSet; int offTeam = -1, offTtl; boolean spIndirect;
    String lastEvent = "";
    public String boardInfo = "Graveto do Árbitro: botão direito = apitar";
    public final java.util.Map<String, Integer> ev = new java.util.TreeMap<>();
    void cnt(String k) { ev.merge(k, 1, Integer::sum); }

    private Match(ServerLevel level, Pitch pitch) { this.level = level; this.pitch = pitch; }

    // =====================================================================================
    //  Criação
    // =====================================================================================

    public static Match create(ServerLevel level, int bx, int gy, int bz, Club home, Club away) {
        Roster.apply(home, away);
        Pitch pitch = new Pitch(level, bx, gy, bz);
        pitch.build();
        Match m = new Match(level, pitch);
        m.forceLoad(true);
        m.spawnAll();
        m.screens = new Screens(m);
        m.crowd = new Crowd(m, 140);
        m.cameras = new Cameras(m);
        m.nar = new Narrator(m);
        m.referee = new Referee(m);
        m.resetForKickoff(0, true);
        return m;
    }

    void forceLoad(boolean on) {
        int x0 = (pitch.bx - Pitch.HALF_L - 8) >> 4, x1 = (pitch.bx + Pitch.HALF_L + 8) >> 4;
        int z0 = (pitch.bz - Pitch.HALF_W - 6) >> 4, z1 = (pitch.bz + Pitch.HALF_W + 6) >> 4;
        for (int cx = x0; cx <= x1; cx++) for (int cz = z0; cz <= z1; cz++) level.setChunkForced(cx, cz, on);
    }

    void spawnAll() {
        spawnPlayers();
        spawnBall();
    }

    void spawnPlayers() {
        for (int t = 0; t < 2; t++) {
            List<Roster.Def> defs = Roster.time(t);
            teams[t] = new FPlayer[defs.size()];
            for (int i = 0; i < defs.size(); i++) {
                FPlayer p = new FPlayer(t, defs.get(i));
                p.e = makeMob(p);
                teams[t][i] = p;
                all.add(p);
            }
        }
    }

    void spawnBall() {
        ball = EntityTypes.SULFUR_CUBE.create(level, EntitySpawnReason.COMMAND);
        ball.removeFreeWill();
        ball.setItemSlot(EquipmentSlot.BODY, new ItemStack(Items.OAK_PLANKS));   // madeira dentro = bola quicante
        ball.setPermanentlyInvulnerable(true);
        ball.setPersistenceRequired();
        ball.setSilent(false);
        ball.addTag("futebol");
        ball.addTag("futebol_bola");
        ball.setCustomName(Component.literal("⚽ Bola"));
        ball.snapTo(pitch.cx(), pitch.surf(), pitch.cz());
        level.addFreshEntity(ball);
    }

    Mob makeMob(FPlayer p) {
        Roster.Def d = p.def;
        Mob e;
        if (p.isGK()) e = EntityTypes.VILLAGER.create(level, EntitySpawnReason.COMMAND);
        else e = (p.team == 0 ? EntityTypes.PILLAGER : EntityTypes.VINDICATOR).create(level, EntitySpawnReason.COMMAND);
        e.removeFreeWill();
        e.setPermanentlyInvulnerable(true);
        e.setPersistenceRequired();
        e.setCanPickUpLoot(false);
        e.setSilent(true);
        e.addTag("futebol");
        e.addTag("futebol_t" + p.team + "_n" + d.num());
        int cor = p.isGK() ? Roster.COR_GOLEIRO[p.team] : Roster.COR_CAMISA[p.team];
        e.setItemSlot(EquipmentSlot.CHEST, dyed(Items.LEATHER_CHESTPLATE, cor));
        e.setItemSlot(EquipmentSlot.LEGS, dyed(Items.LEATHER_LEGGINGS, p.isGK() ? 0x212121 : Roster.COR_CALCAO[p.team]));
        e.setItemSlot(EquipmentSlot.FEET, dyed(Items.LEATHER_BOOTS, p.isGK() ? 0x212121 : 0xEEEEEE));
        for (EquipmentSlot s : EquipmentSlot.values()) if (s.isArmor()) e.setDropChance(s, 0f);
        e.setCustomName(nameTag(p));
        e.setCustomNameVisible(true);
        Vec3 w = W(p.team, d.u(), d.v());
        e.snapTo(w.x, w.y, w.z, yawTo(p.team == 0 ? 1 : -1, 0), 0);
        level.addFreshEntity(e);
        return e;
    }

    static ItemStack dyed(net.minecraft.world.item.Item item, int rgb) {
        ItemStack s = new ItemStack(item);
        s.set(DataComponents.DYED_COLOR, new DyedItemColor(rgb));
        return s;
    }

    static Component nameTag(FPlayer p) {
        int cor = p.isGK() ? Roster.COR_GOLEIRO[p.team] : Roster.COR_CAMISA[p.team];
        int lum = ((cor >> 16) & 255) * 3 + ((cor >> 8) & 255) * 6 + (cor & 255);
        if (lum < 900) cor = 0xBBBBBB;                                   // camisa escura: número em cinza claro
        Component num = Component.literal("#" + p.def.num() + " ").withStyle(Style.EMPTY.withColor(cor).withBold(true));
        return Component.empty().append(num).append(Component.literal(p.def.nome()).withStyle(ChatFormatting.WHITE));
    }

    /** Troca os clubes em campo mantendo o estádio (próxima partida de um campeonato, por exemplo). */
    public void swapClubs(Club home, Club away) {
        for (FPlayer p : all) if (p.e != null) p.e.discard();
        all.clear();
        Roster.apply(home, away);
        score[0] = score[1] = 0; half = 1; clock = 0; attackDir[0] = 1; attackDir[1] = -1;
        st = St.IDLE; stTicks = 0; carrier = null; spin = 0;
        spawnPlayers();
        resetForKickoff(0, true);
        pitch.recolor();
        if (pitch.stadium != null) { crowd.clear(); crowd = new Crowd(this, crowdSize); }
    }

    public int crowdSize = 140;

    public void remove() {
        if (cameras != null) cameras.stopAll();
        if (referee != null) referee.remove();
        if (crowd != null) crowd.clear();
        if (screens != null) screens.remove();
        for (FPlayer p : all) if (p.e != null) p.e.discard();
        if (ball != null) ball.discard();
        all.clear();
        forceLoad(false);
        pitch.restore();
    }

    /** Remove só as entidades (usado ao desligar o servidor). */
    public void discardEntities() {
        for (FPlayer p : all) if (p.e != null) p.e.discard();
        if (ball != null) ball.discard();
        if (crowd != null) crowd.clear();
        if (referee != null) referee.remove();
        if (screens != null) screens.remove();
    }

    // =====================================================================================
    //  Coordenadas (u = metros a partir do gol próprio, v = lateral + para a direita)
    // =====================================================================================

    double U(int t, double x) { return (x - pitch.ownGoalX(attackDir[t])) * attackDir[t] / Pitch.SL; }
    double V(int t, double z) { return (z - pitch.cz()) * attackDir[t] / Pitch.SW; }
    Vec3 W(int t, double u, double v) { return pitch.world(u, v, attackDir[t]); }
    static double hd(Vec3 a, Vec3 b) { return Math.hypot(a.x - b.x, a.z - b.z); }
    static double hd(double ax, double az, double bx, double bz) { return Math.hypot(ax - bx, az - bz); }
    static double clamp(double v, double lo, double hi) { return v < lo ? lo : Math.min(v, hi); }
    Vec3 bp() { return ball.position(); }
    double bh() { return bp().y - pitch.surf(); }
    static float yawTo(double dx, double dz) { return (float) (Math.toDegrees(Math.atan2(-dx, dz))); }
    FPlayer gk(int t) { return teams[t][0]; }

    // =====================================================================================
    //  Controle da partida
    // =====================================================================================

    public void start() {
        if (st == St.IDLE || st == St.FULLTIME) {
            if (st == St.FULLTIME) { score[0] = score[1] = 0; half = 1; clock = 0; attackDir[0] = 1; attackDir[1] = -1; resetForKickoff(0, true); }
            startIntro();
        }
    }

    void resetForKickoff(int team, boolean snap) {
        kickoffTeam = team;
        carrier = null; passTarget = null; lastTouchTeam = -1; lastToucher = null;
        for (FPlayer p : all) { p.holding = false; p.shotActive = false; p.touchCd = 0; p.stun = 0; }
        pinBall(new Vec3(pitch.cx(), pitch.surf(), pitch.cz()));
        if (snap) for (FPlayer p : all) {
            double u = Math.min(p.def.u(), 30);
            Vec3 w = W(p.team, u, p.def.v());
            if (p.team != team && hd(w.x, w.z, pitch.cx(), pitch.cz()) < 7.8) w = W(p.team, Math.min(u, 25), p.def.v());
            p.e.snapTo(w.x, w.y, w.z, yawTo(attackDir[p.team], 0), 0);
            p.vx = p.vz = 0; p.tx = w.x; p.tz = w.z;
        }
    }

    void pinBall(Vec3 pos) {
        ballPinned = true; pinPos = pos;
        ball.snapTo(pos.x, pos.y, pos.z);
        ball.setDeltaMovement(Vec3.ZERO);
        ballVelSet = Vec3.ZERO;
    }

    void unpin() { ballPinned = false; }

    // =====================================================================================
    //  Tick principal
    // =====================================================================================

    public void tick() {
        tickCount++; stTicks++;
        if (tickCount % 20 == 0 && (!ball.isAlive() || all.stream().anyMatch(p -> !p.e.isAlive()))) repair();

        ballFix();
        computeTraj();
        if (crowd != null) crowd.tick();
        if (cameras != null) cameras.tick();
        if (nar != null) nar.tick();
        if (referee != null) referee.tick();
        if (st == St.PLAYING || st == St.SETPIECE || st == St.GOAL) record();
        for (FPlayer p : all) {
            if (p.touchCd > 0) p.touchCd--;
            if (p.tackleCd > 0) p.tackleCd--;
            if (p.stun > 0) p.stun--;
            if (p.headCd > 0) p.headCd--;
            if (p.shoutCd > 0) p.shoutCd--;
            if (p.skillCd > 0) p.skillCd--;
            if (p.giveGoTicks > 0) p.giveGoTicks--;
            if (p.skillTicks > 0) { p.skillTicks--; if (p.skillTicks == 0) p.boost = 1.0; }
        }
        if (passTtl > 0 && --passTtl == 0) passTarget = null;
        if (skillMsgCd > 0) skillMsgCd--;
        if (offTtl > 0 && --offTtl == 0) offSet = null;
        for (int t = 0; t < 2; t++) { if (trans[t] > 0) trans[t]--; if (counterPress[t] > 0) counterPress[t]--; }
        int ct = carrier != null ? carrier.team : -1;
        if (ct >= 0 && ct != lastCarrierTeam) { if (lastCarrierTeam >= 0 && st == St.PLAYING) { if (nar != null && rnd.nextInt(5) == 0) nar.analyst("com_contra"); trans[ct] = 100; counterPress[lastCarrierTeam] = 70; trans[lastCarrierTeam] = 0; } lastCarrierTeam = ct; }

        switch (st) {
            case IDLE -> { holdAll(); }
            case INTRO -> tickIntro();
            case SETPIECE -> tickSetPiece();
            case PLAYING -> tickPlaying();
            case GOAL -> tickGoal();
            case HALFTIME -> tickHalftime();
            case FULLTIME -> holdAll();
            case REPLAY -> tickReplay();
        }
        if (st != St.REPLAY) for (FPlayer p : all) step(p);
        if (ballPinned) { ball.snapTo(pinPos.x, pinPos.y, pinPos.z); ball.setDeltaMovement(Vec3.ZERO); }
        ballVelSet = ball.getDeltaMovement();
        if (tickCount % 10 == 0) hud();
    }

    /** Se alguma entidade sumiu (kill, descarregou), recria. */
    void repair() {
        for (FPlayer p : all) if (!p.e.isAlive()) {
            Vec3 pos = p.e.position();
            p.e = makeMob(p);
            p.e.snapTo(pos.x, pos.y, pos.z);
        }
        if (!ball.isAlive()) {
            Vec3 pos = ball.position();
            ball = EntityTypes.SULFUR_CUBE.create(level, EntitySpawnReason.COMMAND);
            ball.removeFreeWill();
            ball.setItemSlot(EquipmentSlot.BODY, new ItemStack(Items.OAK_PLANKS));
            ball.setPermanentlyInvulnerable(true); ball.addTag("futebol"); ball.addTag("futebol_bola");
            ball.snapTo(pos.x, Math.max(pos.y, pitch.surf()), pos.z);
            level.addFreshEntity(ball);
        }
    }

    /** Física própria da bola: atrito de bola de futebol e quique amortecido, em cima da física do Minecraft. */
    void ballFix() {
        if (ballPinned || (carrier != null)) return;
        Vec3 v = ball.getDeltaMovement(), prev = ballVelSet;
        double hn = Math.hypot(v.x, v.z), hp = Math.hypot(prev.x, prev.z);
        double nx = v.x, nz = v.z, ny = v.y;
        if (ball.onGround()) {
            if (hp > 0.03 && hn > 0.005 && hn / hp > 0.55) {
                double k = hp * DG / hn;
                nx *= k; nz *= k;
            } else if (Math.hypot(nx, nz) < 0.02) { nx = 0; nz = 0; }
        } else if (hp > 0.03 && hn > 0.005 && hn / hp > 0.55 && hn / hp < 0.995) {
            double k = hp * DA / hn;
            nx *= k; nz *= k;
        }
        if (!ball.onGround() && Math.abs(spin) > 1e-5 && hn > 0.1) {     // efeito (Magnus): curva a bola no ar
            double c = Math.cos(spin), sn = Math.sin(spin);
            double rx = nx * c - nz * sn, rz = nx * sn + nz * c;
            nx = rx; nz = rz;
            spin *= 0.996;
        } else if (ball.onGround()) spin = 0;
        if (prev.y < -0.22 && v.y > 0) ny = -prev.y * 0.5;     // quique mais baixo
        if (ny > 0 && ny < 0.1 && ball.onGround()) ny = 0;
        ball.setDeltaMovement(nx, ny, nz);
    }

    /** Prevê a trajetória da bola para os próximos ticks. */
    void computeTraj() {
        Vec3 p = bp(), v = ball.getDeltaMovement();
        double x = p.x, y = p.y, z = p.z, vx = v.x, vy = v.y, vz = v.z, g = pitch.surf();
        if (ballPinned) { vx = vy = vz = 0; }
        for (int i = 0; i < traj.length; i++) {
            traj[i] = new Vec3(x, y, z);
            x += vx; y += vy; z += vz;
            vy = (vy - 0.08) * 0.98;
            boolean ground = false;
            if (y <= g) { y = g; ground = true; vy = vy < -0.22 ? -vy * 0.5 : 0; }
            double h = (ground || y - g < 0.05) ? DG : DA;
            vx *= h; vz *= h;
        }
    }

    // =====================================================================================
    //  Jogo corrido
    // =====================================================================================

    void tickPlaying() {
        clock++;
        if (checkBounds()) return;
        gkShots();
        ballControl();
        if (st != St.PLAYING) return;
        skills();
        if (nar != null && tickCount % 200 == 0 && carrier != null) nar.filler(carrier);
        carrierThink();
        for (int t = 0; t < 2; t++) aiTeam(t);
        // fim do tempo: só termina em bola parada/lance sem perigo
        if (clock >= halfLen && (carrier == null || U(carrier.team, carrier.pos().x) < 40)) endHalf();
    }

    void endHalf() {
        whistle(1.3f);
        if (half == 1) {
            st = St.HALFTIME; stTicks = 0;
            sayV("§e⏸ Intervalo: " + placar());
            if (nar != null) nar.halftime();
        } else {
            st = St.FULLTIME; stTicks = 0;
            String venc = score[0] == score[1] ? "§eEMPATE!" : (score[0] > score[1] ? Roster.COR_CHAT[0] + Roster.TIME_NOME[0] : Roster.COR_CHAT[1] + Roster.TIME_NOME[1]) + " §evence!";
            say("§6🏁 Fim de jogo: " + placar());
            if (crowd != null) crowd.event("end", 0);
            if (nar != null) nar.fulltime();
            if (onFinish != null) { var cb = onFinish; onFinish = null; cb.accept(this); }
        }
        carrier = null; for (FPlayer p : all) { p.holding = false; p.shotActive = false; }
        pinBall(bp());
    }

    void tickHalftime() {
        if (stTicks == 60) {
            half = 2; clock = 0;
            attackDir[0] = -1; attackDir[1] = 1;
            resetForKickoff(1, true);
        }
        if (stTicks > 140) {
            whistle(1.0f);
            beginSetPiece(SP.KICKOFF, 1, new Vec3(pitch.cx(), pitch.surf(), pitch.cz()));
        }
        if (stTicks <= 60) holdAll();
    }

    void tickGoal() {
        if (stTicks == 70 && replaysAuto && rec.size() > 60) { startReplay(true, 8, 0.5); return; }
        celebrate();
        // comemoração: time que marcou pula
        if (stTicks % 14 == 0) for (FPlayer p : all) if (p.team == lastEventTeam && !p.isGK() && rnd.nextInt(3) == 0 && p.e.onGround())
            p.e.setDeltaMovement(p.e.getDeltaMovement().x, 0.42, p.e.getDeltaMovement().z);
        if (stTicks % 6 == 0) {
            Vec3 c = bp();
            level.sendParticles(ParticleTypes.FIREWORK, c.x, c.y + 2, c.z, 12, 3, 1.5, 3, 0.1);
        }
        if (stTicks > 120) {
            int conceded = 1 - lastEventTeam;
            resetForKickoff(conceded, true);
            beginSetPiece(SP.KICKOFF, conceded, new Vec3(pitch.cx(), pitch.surf(), pitch.cz()));
        }
    }

    // =====================================================================================
    //  Entrada em campo, cerimônia e comemoração
    // =====================================================================================

    FPlayer goalScorer;

    void startIntro() {
        st = St.INTRO; stTicks = 0;
        carrier = null;
        for (FPlayer p : all) { p.out = false; p.yellow = 0; p.touchCd = 0; p.tackleCd = 0; p.vx = p.vz = 0; }
    }

    /** Posição na fila de apresentação (de frente para a câmera principal). */
    Vec3 lineupSpot(FPlayer p) {
        int i = java.util.Arrays.asList(teams[p.team]).indexOf(p);
        double x = pitch.cx() + (p.team == 0 ? -18.5 + i * 1.55 : 3 + i * 1.55);
        return new Vec3(x, pitch.surf(), pitch.cz() + 1.0);
    }

    void tickIntro() {
        if (stTicks == 1) {
            // todos saem do túnel (atrás da linha lateral), um atrás do outro
            for (FPlayer p : all) {
                int i = java.util.Arrays.asList(teams[p.team]).indexOf(p);
                double x = pitch.cx() + (p.team == 0 ? -3.0 - i * 1.0 : 3.0 + i * 1.0);
                p.e.snapTo(x, pitch.surf(), pitch.cz() + Pitch.HALF_W + 2.4, 180f, 0);
                p.vx = p.vz = 0;
            }
        }
        for (FPlayer p : all) {
            if (stTicks < 255) { Vec3 l = lineupSpot(p); p.tx = l.x; p.tz = l.z; p.spd = 0.38; }
            else { double u = Math.min(p.def.u(), 30); Vec3 w = W(p.team, u, p.def.v()); p.tx = w.x; p.tz = w.z; p.spd = 0.5; }
            p.mode = FPlayer.Mode.HOLD;
        }
        if (stTicks == 70 && nar != null) nar.intro();
        if (stTicks >= 330) {
            whistle(1.0f);
            resetForKickoff(kickoffTeam, true);
            beginSetPiece(SP.KICKOFF, kickoffTeam, new Vec3(pitch.cx(), pitch.surf(), pitch.cz()));
        }
    }

    /** Comemoração: o artilheiro corre para o canto e o time vai atrás; o adversário abaixa a cabeça. */
    void celebrate() {
        int t = lastEventTeam < 0 ? 0 : lastEventTeam;
        FPlayer sc = goalScorer != null && goalScorer.team == t && goalScorer.e.isAlive() ? goalScorer : null;
        if (sc == null) for (FPlayer p : teams[t]) if (p.def.pos() == Pos.ST) sc = p;
        Vec3 sp = sc.pos();
        double side = attackDir[t], zs = Math.signum(sp.z - pitch.cz() + 0.01);
        Vec3 corner = new Vec3(pitch.cx() + side * (Pitch.HALF_L - 5), pitch.surf(), pitch.cz() + zs * (Pitch.HALF_W - 6));
        for (FPlayer p : all) {
            p.mode = FPlayer.Mode.HOLD;
            if (p.team == t) {
                if (p == sc) { p.tx = corner.x; p.tz = corner.z; p.spd = stTicks < 60 ? 0.95 : 0.2; }
                else if (p.isGK()) { p.tx = p.pos().x; p.tz = p.pos().z; p.spd = 0.2; }
                else { double a = (p.def.num() * 0.9); p.tx = sp.x + Math.cos(a) * 2.2; p.tz = sp.z + Math.sin(a) * 2.2; p.spd = stTicks < 80 ? 0.85 : 0.25; }
            } else { p.tx = p.pos().x; p.tz = p.pos().z; p.spd = 0.2; }
        }
    }

    void holdAll() {
        for (FPlayer p : all) {
            Vec3 b = pitch.world(p.def.u(), p.def.v(), attackDir[p.team]);
            Vec3 w = st == St.HALFTIME || st == St.FULLTIME || st == St.GOAL ? p.pos() : b;
            p.tx = w.x; p.tz = w.z; p.spd = 0.3; p.mode = FPlayer.Mode.HOLD;
            if (st == St.GOAL || st == St.HALFTIME || st == St.FULLTIME) { p.tx = p.pos().x; p.tz = p.pos().z; }
        }
    }

    // =====================================================================================
    //  Limites do campo, gol, escanteio, tiro de meta, lateral
    // =====================================================================================

    boolean checkBounds() {
        Vec3 b = bp();
        double dx = b.x - pitch.cx(), dz = b.z - pitch.cz();
        if (Math.abs(dz) > pitch.limZ()) {                         // lateral
            int team = lastTouchTeam < 0 ? kickoffTeam : 1 - lastTouchTeam;
            double sx = clamp(dx, -Pitch.HALF_L + 2, Pitch.HALF_L - 2);
            sayV("§7↔ Lateral para " + nome(team)); cnt("lateral"); if (nar != null) nar.throwIn(team);
            beginSetPiece(SP.THROW_IN, team, new Vec3(pitch.cx() + sx, pitch.surf(), pitch.cz() + Math.signum(dz) * Pitch.HALF_W));
            return true;
        }
        if (Math.abs(dx) > pitch.limX()) {
            int side = (int) Math.signum(dx);
            int attacker = attackDir[0] == side ? 0 : 1;           // time que ataca esse gol
            int defender = 1 - attacker;
            boolean noGol = Math.abs(dz) < Pitch.GOAL_HALF && bh() < Pitch.GOAL_H - 0.1;
            if (noGol) { goal(attacker); return true; }
            if (lastTouchTeam == defender || lastTouchTeam < 0) {
                double cz = pitch.cz() + (dz >= 0 ? 1 : -1) * (Pitch.HALF_W - 0.5);
                sayV("§7⚑ Escanteio para " + nome(attacker)); cnt("escanteio"); if (nar != null) nar.corner(attacker);
                beginSetPiece(SP.CORNER, attacker, new Vec3(pitch.cx() + side * (Pitch.HALF_L - 0.5), pitch.surf(), cz));
            } else {
                if (tickCount - lastShotTick < 100 && lastToucher != null && lastToucher.team == attacker) { markChance(); if (nar != null) nar.wide(lastToucher); }
                sayV("§7▢ Tiro de meta para " + nome(defender)); cnt("tiro_de_meta"); if (nar != null) nar.goalKick();
                Vec3 spot = new Vec3(pitch.ownGoalX(attackDir[defender]) + attackDir[defender] * 4.5, pitch.surf(), pitch.cz() + (dz >= 0 ? 2.5 : -2.5));
                beginSetPiece(SP.GOAL_KICK, defender, spot);
            }
            return true;
        }
        return false;
    }

    void goal(int team) {
        FPlayer who = lastToucher;
        boolean contra = who != null && who.team != team;
        score[team]++; cnt("gol"); goalMark = recCount; chancePending = false;
        for (ServerPlayer pl : level.players()) { String fav = Tickets.favorito.get(pl.getUUID()); if (fav != null && fav.equals(Roster.ATUAL[team].id())) { pl.connection.send(new ClientboundSetSubtitleTextPacket(Component.literal("§aÉ do seu time!"))); pl.connection.send(new ClientboundSetTitleTextPacket(Component.literal("§6§l⚽ GOOOL DO " + Roster.ATUAL[team].nome().toUpperCase() + "!"))); } }
        lastEventTeam = team;
        st = St.GOAL; stTicks = 0;
        carrier = null;
        for (FPlayer p : all) { p.holding = false; p.shotActive = false; }
        whistle(0.8f);
        if (crowd != null) crowd.event("goal", team);
        level.playSound(null, bp().x, bp().y, bp().z, SoundEvents.FIREWORK_ROCKET_LARGE_BLAST, SoundSource.NEUTRAL, 3f, 1f);
        goalScorer = who;
        if (nar != null && who != null) nar.goal(who, team, contra);
        String autor = who == null ? "" : (contra ? "gol contra de " : "") + who.def.nome() + " (#" + who.def.num() + ")";
        title("§l⚽ GOL", Roster.COR_CHAT[team] + autor);
        say("§e⚽ " + placar() + " §7— " + autor);
        Vec3 b = bp();
        pinBall(new Vec3(b.x, b.y, b.z));
    }

    // =====================================================================================
    //  Reposições de bola
    // =====================================================================================

    void beginSetPiece(SP type, int team, Vec3 spot) {
        st = St.SETPIECE; stTicks = 0; spTicks = 0;
        sp = type; spTeam = team; spSpot = spot; spIndirect = false; offSet = null;
        carrier = null; passTarget = null;
        for (FPlayer p : all) { p.holding = false; p.shotActive = false; }
        pinBall(spot);
        spTaker = pickTaker(type, team, spot);
        if (nar != null) { if (type == SP.PENALTY) nar.penalty(spTaker); else if (type == SP.FREE_KICK && hd(spot, W(team, 64, 0)) < 28 * Pitch.SL) nar.freeKick(spTaker); }
        if (type != SP.KICKOFF) whistle(0.9f);
    }

    FPlayer pickTaker(SP type, int team, Vec3 spot) {
        FPlayer best = null; double bs = -1e9;
        for (FPlayer p : teams[team]) {
            if (p.out) continue;
            double s;
            switch (type) {
                case KICKOFF -> s = p.def.pos() == Pos.ST ? 100 : -50;
                case GOAL_KICK -> s = p.isGK() ? 100 : -100;
                case PENALTY -> s = p.isGK() ? -100 : p.st().fin() * 1.0 + p.st().vis() * 0.2;
                case FREE_KICK -> s = p.isGK() ? -100 : (p.st().pas() * 0.5 + p.st().fin() * 0.5) - hd(p.pos(), spot) * 0.8;
                case CORNER -> s = p.isGK() ? -100 : (p.def.pos().linha >= 2 && p.def.pos() != Pos.ST ? p.st().pas() : 20) - hd(p.pos(), spot) * 0.3;
                default -> s = p.isGK() ? -100 : (p.def.pos() == Pos.FB || p.def.pos() == Pos.WG ? 30 : 0) - hd(p.pos(), spot) * 2.0;
            }
            if (s > bs) { bs = s; best = p; }
        }
        return best;
    }

    void tickSetPiece() {
        spTicks++;
        if (spTicks == 30 && chancePending && replaysChance && tickCount - lastReplayEnd > 1800 && rec.size() > 60) { chancePending = false; if (startReplayCore(chanceMark, 7, 0.6)) return; }
        if (spTicks == 31) chancePending = false;
        pinBall(spSpot);
        // montar as posições
        for (int t = 0; t < 2; t++) aiTeam(t);
        // taker
        Vec3 tgt = spTargetPoint();
        double dx = tgt.x - spSpot.x, dz = tgt.z - spSpot.z, d = Math.max(0.01, Math.hypot(dx, dz));
        double kx = spSpot.x - dx / d * 0.9, kz = spSpot.z - dz / d * 0.9;
        spTaker.tx = kx; spTaker.tz = kz; spTaker.spd = 0.8; spTaker.mode = FPlayer.Mode.SETPIECE;
        boolean near = hd(spTaker.pos().x, spTaker.pos().z, kx, kz) < 1.0;
        int minWait = sp == SP.KICKOFF ? 90 : sp == SP.PENALTY ? 110 : 70;
        boolean gkOk = sp != SP.PENALTY || hd(gk(1 - spTeam).pos().x, gk(1 - spTeam).pos().z, W(1 - spTeam, 0.8, 0).x, W(1 - spTeam, 0.8, 0).z) < 1.3;
        if ((near && spTicks >= minWait && gkOk) || spTicks > 260) executeSetPiece();
    }

    /** Para onde o batedor "olha" na reposição. */
    Vec3 spTargetPoint() {
        return switch (sp) {
            case FREE_KICK, PENALTY, CORNER -> W(spTeam, 64, 0);
            default -> new Vec3(pitch.cx(), pitch.surf(), pitch.cz());
        };
    }

    void executeSetPiece() {
        unpin();
        FPlayer k = spTaker;
        st = St.PLAYING; stTicks = 0;
        lastTouchTeam = spTeam; lastToucher = k;
        k.touchCd = 25;
        Vec3 b = spSpot;
        ball.snapTo(b.x, b.y, b.z);
        switch (sp) {
            case KICKOFF -> {
                if (nar != null) nar.kickoff(half == 2);
                FPlayer r = bestPass(k, false, 3, 20, true);
                if (r == null) r = teams[spTeam][teams[spTeam].length - 1];
                kickPass(k, r, false);
            }
            case THROW_IN -> {
                ball.snapTo(b.x, b.y + 1.9, b.z);
                FPlayer r = bestPass(k, false, 4, 17, true);
                if (r == null) r = nearestTeammate(k);
                kickPass(k, r, true);
            }
            case CORNER -> {
                // alvo: atacante de área mais perigoso
                FPlayer r = null; double bs = -1e9;
                for (FPlayer p : teams[spTeam]) {
                    if (p == k || p.isGK()) continue;
                    double u = U(spTeam, p.pos().x), v = Math.abs(V(spTeam, p.pos().z));
                    if (u < 64 - Pitch.BOXV_D - 2 || v > Pitch.BOXV_H) continue;
                    double s = p.st().forca() * 0.5 + p.st().fin() * 0.5 - openness(p) * -2.0;
                    if (s > bs) { bs = s; r = p; }
                }
                Vec3 target = r != null ? r.pos() : W(spTeam, 58, rnd.nextGaussian() * 3);
                Vec3 gc = W(spTeam, 64, 0);
                double cross = (target.x - b.x) * (gc.z - b.z) - (target.z - b.z) * (gc.x - b.x);
                double curl = Math.signum(cross) * (0.22 + (k.st().pas() - 50) * 0.003);
                kickLob(k, target.x, target.z, 24 + rnd.nextInt(5), 2.4 - k.st().pas() * 0.012, curl);
                cnt("escanteio_curvo");
                passTarget = r; passTtl = 60;
            }
            case GOAL_KICK -> {
                FPlayer r = bestPass(k, true, 12, 40, false);
                if (r == null) r = nearestTeammate(k);
                kickPass(k, r, true);
            }
            case FREE_KICK -> {
                double dGoal = hd(b, W(spTeam, 64, 0));
                if (!spIndirect && dGoal < (24 + k.st().fin() * 0.05) * Pitch.SL && rnd.nextDouble() < 0.4 + k.st().fin() * 0.004) freeKickShot(k);
                else {
                    FPlayer r = bestPass(k, true, 5, 30, false);
                    if (r == null) r = nearestTeammate(k);
                    kickPass(k, r, hd(k.pos(), r.pos()) > 16 * Pitch.SL);
                }
            }
            case PENALTY -> {
                FPlayer g = gk(1 - spTeam);
                double side = rnd.nextBoolean() ? 1 : -1;
                shootAt(k, 64, side * (Pitch.GOAL_HALF - 1.1) / Pitch.SW * (0.4 + k.st().fin() * 0.0035), 0.5 + rnd.nextDouble() * 0.9, 1.0, 0.8);
                // goleiro escolhe um canto (chuta; os melhores adivinham mais)
                boolean acerta = rnd.nextDouble() < 0.40 + (g.st().ref() - 50) * 0.003;
                double gz = (acerta ? side : -side) * 2.3;
                g.shotActive = true; g.shotTicks = 0; g.shotReact = 2;
                g.aimZ = pitch.cz() + gz * attackDir[1 - spTeam]; g.aimY = 0.8; g.jumped = false;
            }
        }
    }

    // =====================================================================================
    //  Controle de bola: domínio, desarme, goleiro, cabeceio
    // =====================================================================================

    void ballControl() {
        // goleiro segurando
        for (int t = 0; t < 2; t++) {
            FPlayer g = gk(t);
            if (g.holding) {
                Vec3 pos = g.pos();
                ball.snapTo(pos.x + g.fx * 0.45, pos.y + 1.0, pos.z + g.fz * 0.45);
                ball.setDeltaMovement(Vec3.ZERO);
                g.holdTicks++;
                carrier = g;
                if (g.holdTicks >= g.holdMax) distribute(g);
                return;
            }
        }
        if (carrier != null) {
            FPlayer c = carrier;
            if (hd(c.pos(), bp()) > 2.6 || c.stun > 12) { release(c, 20); }
            else {
                glue(c);
                c.ctrlTicks++;
                tackles(c);
                return;
            }
        }
        // bola solta: tentativas de domínio / cabeceio
        FPlayer best = null; double bs = -1e9;
        boolean air = bh() > 0.9;
        Vec3 b = bp();
        double bv = Math.hypot(ball.getDeltaMovement().x, ball.getDeltaMovement().z);
        for (FPlayer p : all) {
            if (p.touchCd > 0 || p.stun > 6) continue;
            double d = hd(p.pos(), b);
            double reach = p.isGK() ? 1.5 : 1.05;
            if (!air && d > reach) continue;
            if (air) {
                if (d > 1.35 || p.headCd > 0 || bh() > 2.7) continue;
            }
            if (!air && Math.abs(b.y - p.pos().y) > 1.2) continue;
            double s = p.st().dri() * 0.3 + p.st().vel() * 0.1 + (air ? p.st().forca() * 0.4 : 0) + rnd.nextDouble() * 40 - d * 12
                    + (p == passTarget ? 25 : 0) + (p.mode == FPlayer.Mode.CHASE || p.mode == FPlayer.Mode.RECEIVE ? 10 : 0);
            if (s > bs) { bs = s; best = p; }
        }
        if (best == null) return;
        FPlayer p = best;
        if (offSet != null) {
            if (p.team != offTeam) offSet = null;
            else if (offSet.contains(p) && st == St.PLAYING) { offside(p); return; }
        }
        if (air) { header(p); return; }
        if (p.isGK() && inBox(p.team, b)) {
            double chance = clamp(0.55 + p.st().ref() * 0.004 - bv * 0.35, 0.2, 0.95);
            if (lastToucher != null && lastToucher.team == p.team && lastToucher != p && !p.holding) chance = 0;   // recuo: não pode pegar com a mão
            if (rnd.nextDouble() < chance && bh() < 1.8) { gkCatch(p); return; }
        }
        double chance = clamp(0.56 + p.st().dri() * 0.0040 + p.st().vis() * 0.001 - bv * 0.24
                + (p.team == lastTouchTeam ? 0.06 : 0) + (p == passTarget ? 0.14 : 0), 0.12, 0.97);
        lastTouchTeam = p.team; lastToucher = p;
        if (rnd.nextDouble() < chance) {
            cnt("dominio_ok"); carrier = p; p.ctrlTicks = 0; passTarget = null; passTtl = 0;
        } else {
            cnt("dominio_ruim");
            Vec3 v = ball.getDeltaMovement();
            double ang = rnd.nextDouble() * Math.PI * 2, sp = 0.18 + bv * 0.4;
            ball.setDeltaMovement(v.x * 0.35 + Math.cos(ang) * sp, v.y * 0.3, v.z * 0.35 + Math.sin(ang) * sp);
            p.touchCd = 10;
        }
    }

    void glue(FPlayer c) {
        double off = 0.85 + 0.12 * Math.sin(tickCount * 0.7) * Math.min(1, Math.hypot(c.vx, c.vz) / 0.2);
        Vec3 p = c.pos();
        ball.snapTo(p.x + c.fx * off, pitch.surf(), p.z + c.fz * off);
        ball.setDeltaMovement(c.vx, 0, c.vz);
        ballVelSet = ball.getDeltaMovement();
        lastTouchTeam = c.team; lastToucher = c;
    }

    void release(FPlayer c, int cd) { c.touchCd = cd; if (carrier == c) carrier = null; }

    void tackles(FPlayer c) {
        cnt("tick_tackle_check");
        if (c.holding) return;
        for (FPlayer o : teams[1 - c.team]) {
            if (o.isGK() || o.tackleCd > 0 || o.stun > 0) continue;
            if (hd(o.pos(), c.pos()) > 1.45) continue;
            if (o.mode != FPlayer.Mode.PRESS && o.mode != FPlayer.Mode.MARK && o.mode != FPlayer.Mode.CHASE) continue;
            o.tackleCd = 22;
            double p = clamp(0.24 + (o.st().des() - c.st().dri()) * 0.0065 + (o.st().forca() - c.st().forca()) * 0.002 + 0.08
                    - (Math.hypot(c.vx, c.vz) > 0.25 ? 0.05 : 0), 0.06, 0.72);
            if (c.skillTicks > 0) p *= 0.45;
            cnt("desarme_tentativa");
            if (rnd.nextDouble() < p) {
                cnt("desarme_ok");
                boolean clean = rnd.nextDouble() < 0.45 + o.st().des() * 0.003;
                c.stun = 16 + o.st().forca() / 8;
                double kx = c.pos().x - o.pos().x, kz = c.pos().z - o.pos().z, kd = Math.max(0.1, Math.hypot(kx, kz));
                c.vx += kx / kd * (0.10 + o.st().forca() * 0.003); c.vz += kz / kd * (0.10 + o.st().forca() * 0.003);
                if (clean) { carrier = o; o.ctrlTicks = 0; release(c, 25); lastTouchTeam = o.team; lastToucher = o; }
                else {
                    release(c, 25);
                    double ang = rnd.nextDouble() * Math.PI * 2;
                    ball.setDeltaMovement(Math.cos(ang) * 0.45, 0.05, Math.sin(ang) * 0.45);
                    lastTouchTeam = o.team; lastToucher = o; o.touchCd = 0;
                }
                level.playSound(null, c.pos().x, c.pos().y, c.pos().z, SoundEvents.PLAYER_ATTACK_STRONG, SoundSource.NEUTRAL, 0.8f, 1.1f);
                return;
            } else if (rnd.nextDouble() < 0.008 + o.st().agr() * 0.0007) {
                foul(o, c);
                return;
            }
        }
    }

    void giveCard(FPlayer p, boolean red) {
        cnt(red ? "vermelho" : "amarelo");
        if (nar != null) nar.card(p, red);
        if (crowd != null) crowd.event("foul", p.team);
        Component msg = Component.literal(red ? "§c🟥 Expulso: §f" + p.def.nome() + " §7(#" + p.def.num() + ")" : "§e🟨 Cartão amarelo: §f" + p.def.nome() + " §7(#" + p.def.num() + ")");
        for (ServerPlayer pl : level.players()) pl.sendSystemMessage(msg, true);
        if (red) { p.out = true; p.touchCd = 999999; p.tackleCd = 999999; if (carrier == p) carrier = null; }
    }

    Vec3 benchSpot(FPlayer p) { return new Vec3(pitch.cx() + (p.team == 0 ? -18 : 18), pitch.surf(), pitch.cz() + Pitch.HALF_W + 2.4); }

    boolean inBox(int t, Vec3 pos) {
        return U(t, pos.x) < Pitch.BOXV_D + 0.5 && Math.abs(V(t, pos.z)) < Pitch.BOXV_H + 0.5;
    }

    void foul(FPlayer fouler, FPlayer victim) {
        foulVictim = victim;
        if (nar != null) nar.foul(fouler);
        Vec3 spot = victim.pos();
        whistle(1.1f);
        boolean pen = inBox(fouler.team, spot);
        double rP = 0.02 + fouler.st().agr() * 0.0008, yP = 0.14 + fouler.st().agr() * 0.0035;
        boolean red = rnd.nextDouble() < rP, yel = !red && rnd.nextDouble() < yP;
        if (yel && ++fouler.yellow >= 2) { red = true; yel = false; }
        if (yel || red) giveCard(fouler, red);
        cnt(pen ? "penalti" : "falta"); if (crowd != null) crowd.event("foul", fouler.team); sayV("§c✋ Falta de " + Roster.COR_CHAT[fouler.team] + fouler.def.nome() + " §c(#" + fouler.def.num() + ")" + (pen ? " — §lPÊNALTI!" : ""));
        if (pen) {
            Vec3 ps = W(victim.team, 64 - Pitch.PEN_SPOT_V, 0);
            beginSetPiece(SP.PENALTY, victim.team, new Vec3(ps.x, pitch.surf(), ps.z));
        } else beginSetPiece(SP.FREE_KICK, victim.team, new Vec3(spot.x, pitch.surf(), spot.z));
    }

    void header(FPlayer p) {
        p.headCd = 20;
        lastTouchTeam = p.team; lastToucher = p; carrier = null; passTarget = null;
        p.touchCd = 8;
        double fn = U(p.team, p.pos().x);
        double dGoal = hd(p.pos(), W(p.team, 64, 0));
        if (fn > 64 - 17 && dGoal < 17 * Pitch.SL && !p.isGK()) {
            shootAt(p, 64, rnd.nextGaussian() * 1.8, 0.4 + rnd.nextDouble() * 0.8, 0.95, 1.8);
        } else {
            // cabeceio de apoio ou afastamento (sempre baixo, para a bola não ficar "no ar" para sempre)
            FPlayer r = bestPass(p, true, 3, 20, false);
            if (r != null && lastPassScore > 6) kickGround(p, r.pos().x, r.pos().z, 0.9);
            else {
                double z = pitch.cz() + Math.signum(p.pos().z - pitch.cz() + 0.01) * 15;
                Vec3 tg = W(p.team, Math.min(58, U(p.team, p.pos().x) + 14), V(p.team, z));
                kickGround(p, tg.x, tg.z, 1.0);
            }
            Vec3 bv = ball.getDeltaMovement();
            ball.setDeltaMovement(bv.x, 0.12, bv.z);
        }
    }

    // =====================================================================================
    //  Goleiro
    // =====================================================================================

    void gkCatch(FPlayer g) {
        offSet = null;
        g.holding = true; g.holdTicks = 0; g.holdMax = 25 + rnd.nextInt(30);
        carrier = g; lastTouchTeam = g.team; lastToucher = g; g.shotActive = false; passTarget = null;
        g.vx = g.vz = 0;
        level.playSound(null, g.pos().x, g.pos().y, g.pos().z, SoundEvents.ARMOR_EQUIP_LEATHER.value(), SoundSource.NEUTRAL, 1f, 1.3f);
    }

    void distribute(FPlayer g) {
        g.holding = false; carrier = null; g.touchCd = 30;
        FPlayer r = bestPass(g, true, 6, 45, false);
        if (r == null) r = nearestTeammate(g);
        double d = hd(g.pos(), r.pos());
        lastTouchTeam = g.team; lastToucher = g;
        ball.snapTo(g.pos().x + g.fx * 0.6, pitch.surf() + 1.0, g.pos().z + g.fz * 0.6);
        kickPass(g, r, d > 14);
    }

    /** Detecta chutes ao gol e faz o goleiro reagir. */
    void gkShots() {
        Vec3 v = ball.getDeltaMovement();
        double hv = Math.hypot(v.x, v.z);
        for (int t = 0; t < 2; t++) {
            FPlayer g = gk(t);
            if (g.holding) continue;
            if (!g.shotActive && hv > 0.5 && carrier == null && lastTouchTeam != t) {
                for (int n = 1; n < traj.length; n++) {
                    if (U(t, traj[n].x) <= 0.4) {
                        double z = V(t, traj[n].z), y = traj[n].y - pitch.surf();
                        if (Math.abs(z * Pitch.SW) < Pitch.GOAL_HALF + 1.8 && y < Pitch.GOAL_H + 0.4 && y > -0.1 && U(t, bp().x) > 0.5) {
                            double sd = 0.5 + (100 - g.st().ref()) * 0.032 + (100 - g.st().vis()) * 0.006;
                            g.shotActive = true; g.shotTicks = 0; g.jumped = false;
                            g.shotReact = (int) Math.round(7 - g.st().ref() * 0.055);
                            g.aimZ = pitch.cz() + (z + rnd.nextGaussian() * sd) * attackDir[t];
                            g.aimY = y + rnd.nextGaussian() * 0.25;
                        }
                        break;
                    }
                }
            }
            if (g.shotActive) {
                g.shotTicks++;
                boolean pastGoal = U(t, bp().x) < -0.3 || hv < 0.12 || g.shotTicks > 70;
                // defesa?
                double reach = 1.05 + g.st().ref() * 0.0085;
                Vec3 gp = g.pos(), b = bp();
                double dy = b.y - gp.y;
                double hdist = hd(gp, b);
                boolean heading = (v.x * attackDir[t]) < 0.0;       // vindo em direção ao gol
                if (heading && hdist < reach && dy > -0.5 && dy < (g.e.onGround() ? 2.25 : 3.1) && bh() < 3.1) {
                    gkSave(g, hv);
                } else if (pastGoal) g.shotActive = false;
            }
        }
    }

    void gkSave(FPlayer g, double speed) {
        g.shotActive = false; markChance();
        lastTouchTeam = g.team; lastToucher = g;
        double catchP = clamp(0.88 - speed * 0.5 + g.st().ref() * 0.0035 + g.st().forca() * 0.001 - (bh() > 1.9 ? 0.15 : 0), 0.08, 0.92);
        Vec3 b = bp();
        if (rnd.nextDouble() < catchP) {
            gkCatch(g);
            if (crowd != null) crowd.event("save", g.team); if (nar != null) nar.save(g); cnt("defesa"); sayV("§b🧤 Defesa de " + Roster.COR_CHAT[g.team] + g.def.nome() + "§b!");
        } else {
            double out = Math.signum(b.z - g.pos().z + (rnd.nextDouble() - 0.5) * 0.2);
            double ang = Math.toRadians(35 + rnd.nextDouble() * 55);
            double dir = -attackDir[g.team];                     // para dentro do campo
            double s = Math.max(0.35, speed * 0.55);
            ball.setDeltaMovement(dir * Math.cos(ang) * s * 0.55, 0.18 + rnd.nextDouble() * 0.15, out * Math.sin(ang) * s);
            g.touchCd = 15;
            if (crowd != null) crowd.event("save", g.team); if (nar != null) nar.save(g); cnt("espalmada"); sayV("§b🧤 Espalmou " + Roster.COR_CHAT[g.team] + g.def.nome() + "§b!");
        }
        level.playSound(null, b.x, b.y, b.z, SoundEvents.ARMOR_EQUIP_LEATHER.value(), SoundSource.NEUTRAL, 1f, 0.9f);
    }

    // =====================================================================================
    //  Chutes e passes (aqui entra a precisão por estatística)
    // =====================================================================================

    int pressure(FPlayer p, double radius) {
        int n = 0;
        for (FPlayer o : teams[1 - p.team]) if (hd(o.pos(), p.pos()) < radius) n++;
        return n;
    }

    /** Distância ao oponente mais próximo de um ponto. */
    double openness(FPlayer p) { return openAt(p.pos().x, p.pos().z, p.team); }

    double openAt(double x, double z, int team) {
        double m = 12;
        for (FPlayer o : teams[1 - team]) m = Math.min(m, hd(o.pos().x, o.pos().z, x, z));
        return m;
    }

    /** Chute a gol: alvo (u,v) na linha do gol, com altura. err = multiplicador do erro, spd = potência 0..1. */
    void shootAt(FPlayer k, double u, double v, double height, double power, double errMul) { shootAt(k, u, v, height, power, errMul, 0, 0); }

    /** curl = rotação total (rad) da trajetória; minVy garante altura mínima (barreira). */
    void shootAt(FPlayer k, double u, double v, double height, double power, double errMul, double curl, double minVy) {
        lastShotTick = tickCount;
        Vec3 tgt = W(k.team, u, v);
        Stats s = k.st();
        double d = hd(k.pos().x, k.pos().z, tgt.x, tgt.z);
        double speed = clamp(0.9 + s.fin() * 0.0045 + s.forca() * 0.0020, 0.95, 1.55) * power;
        double press = 1 + 0.18 * pressure(k, 3.0) + (Math.hypot(k.vx, k.vz) > 0.3 ? 0.12 : 0);
        double sd = (0.7 + (100 - s.fin()) * 0.045) * press * errMul;          // desvio angular em graus
        double yaw = Math.atan2(tgt.z - bp().z, tgt.x - bp().x) + Math.toRadians(rnd.nextGaussian() * sd) - curl / 2;
        double t = Math.max(3, d / (speed * 0.93));
        double vy = Math.max(minVy, (height + 0.04 * t * t) / t);
        vy += rnd.nextGaussian() * (0.012 + (100 - s.fin()) * 0.0014) * press;
        if (s.fin() < 55 && rnd.nextDouble() < 0.05) vy += 0.08;       // finalização ruim: bola nas nuvens
        kick(k, Math.cos(yaw) * speed, vy, Math.sin(yaw) * speed);
        spin = curl / t;
    }

    void shoot(FPlayer k, double errMul) {
        FPlayer g = gk(1 - k.team);
        double gv = V(k.team, g.pos().z);
        double maxOff = (Pitch.GOAL_HALF - 1.1) / Pitch.SW;
        double aim = maxOff * (0.30 + k.st().fin() * 0.0035);
        double side = gv > 0.4 ? -1 : gv < -0.4 ? 1 : (rnd.nextBoolean() ? 1 : -1);
        double h = rnd.nextDouble() < (0.15 + k.st().fin() * 0.003) ? 1.5 + rnd.nextDouble() * 0.5 : 0.3 + rnd.nextDouble() * 0.9;
        double d = hd(k.pos(), W(k.team, 64, 0));
        double curl = 0;
        boolean cavada = d < 19 && g.pos().x != 0 && U(1 - k.team, g.pos().x) > 4.2 && k.st().fin() >= 72 && k.st().dri() >= 70 && rnd.nextDouble() < 0.55;
        if (cavada) {                                               // cavadinha por cima do goleiro que saiu
            shootAt(k, 64, rnd.nextGaussian() * 0.8, 1.9, 0.62, 0.9);
            Vec3 bv = ball.getDeltaMovement(); ball.setDeltaMovement(bv.x, Math.max(bv.y, 0.42), bv.z);
            sayV("§d✨ Cavadinha de " + Roster.COR_CHAT[k.team] + k.def.nome() + "§d!"); cnt("cavadinha"); return;
        }
        if (d > 11 && k.st().fin() >= 65 && rnd.nextDouble() < (k.st().fin() - 55) * 0.011) {
            curl = (0.10 + rnd.nextDouble() * 0.10) * (rnd.nextBoolean() ? 1 : -1);
            h = Math.max(h, 1.0 + rnd.nextDouble() * 0.6);
            cnt("chute_curva");
        }
        shootAt(k, 64, side * aim, h, 1.0, errMul, curl, 0);
        sayV("§f" + Roster.COR_CHAT[k.team] + k.def.nome() + (curl != 0 ? "§f chuta com efeito!" : "§f chuta!")); cnt("chute_t" + k.team); if (crowd != null) crowd.event("chance", k.team); if (nar != null) nar.shot(k);
    }


    /** Falta direta: bola com efeito por cima da barreira. */
    void freeKickShot(FPlayer k) {
        FPlayer g = gk(1 - k.team);
        double gv = V(k.team, g.pos().z);
        double side = gv > 0.4 ? -1 : gv < -0.4 ? 1 : (rnd.nextBoolean() ? 1 : -1);
        double speed = clamp(0.9 + k.st().fin() * 0.0045 + k.st().forca() * 0.002, 0.95, 1.55);
        double tw = 7.9 / (speed * 0.96);
        double minVy = (2.5 + 0.04 * tw * tw) / tw;
        double curl = (0.20 + (k.st().fin() - 50) * 0.003) * (rnd.nextBoolean() ? 1 : -1);
        double aim = (Pitch.GOAL_HALF - 1.1) / Pitch.SW * (0.35 + k.st().fin() * 0.0035);
        shootAt(k, 64, side * aim, 1.2, 1.0, 1.0, curl, minVy);
        sayV("§d🎯 Falta cobrada por " + Roster.COR_CHAT[k.team] + k.def.nome() + "§d, com efeito!");
        cnt("falta_chute");
    }

    /** +1 se o adversário mais perto da linha de passe está à esquerda dela, -1 à direita, 0 se livre. */
    double laneBlocker(FPlayer from, double tx, double tz) {
        double ax = from.pos().x, az = from.pos().z, dx = tx - ax, dz = tz - az, len2 = dx * dx + dz * dz + 1e-6;
        double best = 1.5, sign = 0;
        for (FPlayer o : teams[1 - from.team]) {
            double t = clamp(((o.pos().x - ax) * dx + (o.pos().z - az) * dz) / len2, 0, 1);
            if (t < 0.12) continue;
            double px = ax + dx * t, pz = az + dz * t;
            double d = hd(o.pos().x, o.pos().z, px, pz);
            if (d < best) { best = d; sign = Math.signum(dx * (o.pos().z - az) - dz * (o.pos().x - ax)); }
        }
        return sign;
    }

    /** Passe rasteiro (ou lançamento alto quando air=true), com leitura de lance. */
    void kickPass(FPlayer k, FPlayer r, boolean air) {
        cnt(air ? "passe_alto" : "passe");
        if (air) { Vec3 lead = lead(r, 14); kickLob(k, lead.x, lead.z, 16 + (int) (hd(k.pos(), r.pos()) * 0.6), 3.5); }
        else {
            double d = hd(k.pos(), r.pos());
            Vec3 lead = lead(r, d / 0.9);
            double bl = d > 8 && k.st().pas() >= 72 && k.st().vis() >= 62 ? laneBlocker(k, lead.x, lead.z) : 0;
            if (bl != 0 && rnd.nextDouble() < 0.75) {               // passe de trivela: contorna o marcador
                kickLob(k, lead.x, lead.z, (int) clamp(8 + d * 0.8, 12, 30), 1.0, bl * (0.22 + rnd.nextDouble() * 0.12));
                cnt("passe_curvo");
            } else kickGround(k, lead.x, lead.z, 1.0);
        }
        passTarget = r; passTtl = 70;
        markOffside(k);
        double dd = hd(k.pos(), r.pos());
        if (!air && dd < 20 * Pitch.SL && k.def.pos().linha >= 2 && r.def.pos().linha >= 2 && k.st().vis() >= 60 && rnd.nextDouble() < 0.35) { k.giveGoTicks = 70; k.giveGoTarget = r; }
    }

    Vec3 lead(FPlayer r, double ticks) {
        double t = Math.min(ticks, 18);
        return new Vec3(r.pos().x + r.vx * t, r.pos().y, r.pos().z + r.vz * t);
    }

    void kickGround(FPlayer k, double tx, double tz, double power) {
        Vec3 b = bp();
        double d = hd(b.x, b.z, tx, tz);
        double speed = clamp(0.35 + 0.035 * d, 0.45, 1.75) * power;
        double press = 1 + 0.2 * pressure(k, 2.8);
        double sd = (0.8 + (100 - k.st().pas()) * 0.06) * press * (0.7 + d / 40);
        double yaw = Math.atan2(tz - b.z, tx - b.x) + Math.toRadians(rnd.nextGaussian() * sd);
        speed *= 1 + rnd.nextGaussian() * (0.02 + (100 - k.st().pas()) * 0.0006);
        kick(k, Math.cos(yaw) * speed, 0.02, Math.sin(yaw) * speed);
    }

    /** Bola alta que (idealmente) cai perto de (tx,tz) após ~T ticks. */
    void kickLob(FPlayer k, double tx, double tz, int T, double extraErr) { kickLob(k, tx, tz, T, extraErr, 0); }

    void kickLob(FPlayer k, double tx, double tz, int T, double extraErr, double curl) {
        Vec3 b = bp();
        double d = hd(b.x, b.z, tx, tz);
        T = Math.max(10, T);
        double press = 1 + 0.15 * pressure(k, 2.8);
        double sd = (1.0 + (100 - k.st().pas()) * 0.07) * press + extraErr * 0.3;
        double yaw = Math.atan2(tz - b.z, tx - b.x) + Math.toRadians(rnd.nextGaussian() * sd) - curl / 2;
        double hs = d / (T * 0.96) * (1 + rnd.nextGaussian() * (0.03 + (100 - k.st().pas()) * 0.0007));
        double vy = 0.040 * T + 0.01;
        kick(k, Math.cos(yaw) * hs, vy, Math.sin(yaw) * hs);
        spin = curl / T;
    }

    void kick(FPlayer k, double vx, double vy, double vz) {
        unpin();
        carrier = null; spin = 0;
        if (k.holding) k.holding = false;
        ball.setDeltaMovement(vx, vy, vz);
        ballVelSet = ball.getDeltaMovement();
        k.touchCd = 16; k.ctrlTicks = 0;
        lastTouchTeam = k.team; lastToucher = k;
        Vec3 b = bp();
        ball.snapTo(b.x + vx * 0.3, Math.max(b.y, pitch.surf()) + (vy > 0.1 ? 0.15 : 0), b.z + vz * 0.3);
        level.playSound(null, b.x, b.y, b.z, SoundEvents.SULFUR_CUBE_BOUNCY_HIT, SoundSource.NEUTRAL, 1.2f, 0.9f + rnd.nextFloat() * 0.3f);
    }

    FPlayer nearestTeammate(FPlayer k) {
        FPlayer b = null; double bd = 1e9;
        for (FPlayer p : teams[k.team]) if (p != k && !p.isGK()) { double d = hd(p.pos(), k.pos()); if (d < bd) { bd = d; b = p; } }
        return b;
    }


    // =====================================================================================
    //  Fintas e dribles
    // =====================================================================================

    static final String[] SKILL = {"finta de corpo", "pedalada", "elástico", "chapéu", "caneta"};

    boolean trySkill(FPlayer c, int press) {
        if (c.skillCd > 0 || c.isGK() || c.holding) return false;
        FPlayer o = null; double bd = 3.2;
        for (FPlayer q : teams[1 - c.team]) {
            if (q.isGK()) continue;
            double dx = q.pos().x - c.pos().x, dz = q.pos().z - c.pos().z, d = Math.hypot(dx, dz);
            if (d < bd && (dx * c.fx + dz * c.fz) / Math.max(d, 0.01) > 0.3) { bd = d; o = q; }
        }
        if (o == null || bd < 1.1) return false;
        int dri = c.st().dri();
        double prob = 0.10 + dri * 0.0055 + (c.def.pos().linha == 3 ? 0.12 : c.def.pos().linha == 2 ? 0.04 : -0.10);
        if (dGoalOf(c) < 11 * Pitch.SL) prob *= 0.4;                      // na cara do gol: chuta
        if (rnd.nextDouble() > prob) return false;
        // escolhe o lance conforme a habilidade
        double r = rnd.nextDouble() * 100;
        int type = 0;
        if (dri >= 80 && r < 22) type = 2;
        else if (dri >= 70 && bd > 1.8 && r < 42) type = 3;
        else if (dri >= 60 && bd < 2.3 && r < 58) type = 4;
        else if (dri >= 65 && r < 80) type = 1;
        c.skillCd = 60 + rnd.nextInt(40);
        c.skillType = type; c.skillTarget = o; c.skillSide = rnd.nextBoolean() ? 1 : -1; c.skillResolved = false;
        c.skillFx = c.fx; c.skillFz = c.fz;
        double p = clamp(0.36 + (dri - o.st().des()) * 0.009 + (c.st().vel() - o.st().vel()) * 0.002 - 0.05 * Math.max(0, press - 1), 0.08, 0.88);
        if (type == 3 || type == 4) { skillBall(c, o, type, p); return true; }
        c.skillTicks = type == 1 ? 26 : type == 2 ? 18 : 22;
        c.skillSplit = type == 1 ? 15 : type == 2 ? 9 : 12;
        c.e.swing(net.minecraft.world.InteractionHand.MAIN_HAND, net.minecraft.world.item.component.SwingAnimation.DEFAULT, false);
        c.e.setDeltaMovement(c.e.getDeltaMovement().x, 0.2, c.e.getDeltaMovement().z);    // saltinho
        skillSuccess.put(c, p + (type == 2 ? 0.08 : type == 1 ? 0.04 : 0));
        return true;
    }

    final java.util.Map<FPlayer, Double> skillSuccess = new java.util.HashMap<>();

    double dGoalOf(FPlayer c) { return hd(c.pos(), W(c.team, 64, 0)); }

    /** Chapéu e caneta: a bola passa pelo adversário e o jogador corre para pegar do outro lado. */
    void skillBall(FPlayer c, FPlayer o, int type, double p) {
        boolean ok = rnd.nextDouble() < p;
        unpin();
        carrier = null; c.touchCd = 4; passTarget = c; passTtl = 45;
        double fx = c.fx, fz = c.fz;
        double dist = hd(c.pos(), o.pos());
        if (type == 3) {                                                  // chapéu
            double hs = ok ? 0.45 : 0.25;
            ball.setDeltaMovement(fx * hs, 0.43, fz * hs);
        } else {                                                          // caneta: por baixo das pernas
            double hs = ok ? 0.85 : 0.5;
            ball.setDeltaMovement(fx * hs, 0.03, fz * hs);
        }
        ballVelSet = ball.getDeltaMovement(); spin = 0;
        lastTouchTeam = c.team; lastToucher = c;
        c.e.swing(net.minecraft.world.InteractionHand.MAIN_HAND, net.minecraft.world.item.component.SwingAnimation.DEFAULT, false);
        if (ok) { o.stun = 14; o.vx *= 0.3; o.vz *= 0.3; announceSkill(c, o, type); cnt("drible_ok"); }
        else { o.touchCd = 0; cnt("drible_falha"); }
    }

    void announceSkill(FPlayer c, FPlayer o, int type) {
        if (crowd != null) crowd.event("skill", c.team);
        if (nar != null) nar.skill(c, type);
        if (skillMsgCd > 0) return;
        skillMsgCd = 80;
        sayV("§d✨ " + Roster.COR_CHAT[c.team] + c.def.nome() + "§d aplica " + (type == 3 || type == 4 ? "uma " : "um ") + SKILL[type] + " em " + Roster.COR_CHAT[o.team] + o.def.nome() + "§d!");
        level.playSound(null, c.pos().x, c.pos().y, c.pos().z, SoundEvents.VILLAGER_CELEBRATE, SoundSource.NEUTRAL, 1f, 1.2f);
    }

    /** Resolve fintas em andamento (no meio do movimento) e faz os saltinhos da pedalada. */
    void skills() {
        for (FPlayer c : all) {
            if (c.skillTicks <= 0) continue;
            if (c.skillType == 1 && (c.skillTicks == c.skillSplit + 7 || c.skillTicks == c.skillSplit + 3)) {
                c.e.setDeltaMovement(c.e.getDeltaMovement().x, 0.2, c.e.getDeltaMovement().z);
                c.e.swing(net.minecraft.world.InteractionHand.MAIN_HAND, net.minecraft.world.item.component.SwingAnimation.DEFAULT, false);
            }
            if (!c.skillResolved && c.skillTicks <= c.skillSplit) {
                c.skillResolved = true;
                FPlayer o = c.skillTarget;
                double p = skillSuccess.getOrDefault(c, 0.4);
                if (carrier != c || o == null) { c.skillTicks = 0; c.boost = 1; continue; }
                if (rnd.nextDouble() < p) {
                    double sx = -c.skillFz * c.skillSide, sz = c.skillFx * c.skillSide;
                    o.stun = 20; o.vx += sx * 0.22; o.vz += sz * 0.22;       // adversário vai pro lado errado
                    cnt("drible_ok"); announceSkill(c, o, c.skillType);
                } else {
                    cnt("drible_falha");
                    carrier = o; o.ctrlTicks = 0; release(c, 25); lastTouchTeam = o.team; lastToucher = o;
                    c.skillTicks = 0; c.boost = 1;
                }
            }
        }
    }


    // =====================================================================================
    //  Impedimento
    // =====================================================================================

    /** Registra quem estava em posição de impedimento no momento do passe. */
    void markOffside(FPlayer k) {
        double off = offsideLine(k.team), ku = U(k.team, k.pos().x);
        java.util.Set<FPlayer> set = new java.util.HashSet<>();
        for (FPlayer r : teams[k.team]) {
            if (r == k || r.isGK()) continue;
            if (U(k.team, r.pos().x) > Math.max(off, ku) + 0.15) set.add(r);
        }
        offSet = set.isEmpty() ? null : set; offTeam = k.team; offTtl = 110;
    }

    void offside(FPlayer p) {
        offSet = null;
        whistle(1.1f);
        cnt("impedimento");
        if (nar != null) nar.offside(p);
        sayV("§e🚩 Impedimento de " + Roster.COR_CHAT[p.team] + p.def.nome());
        if (crowd != null) crowd.event("foul", p.team);
        Vec3 pp = p.pos();
        Vec3 spot = new Vec3(clamp(pp.x, pitch.cx() - Pitch.HALF_L + 2, pitch.cx() + Pitch.HALF_L - 2), pitch.surf(), clamp(pp.z, pitch.cz() - Pitch.HALF_W + 2, pitch.cz() + Pitch.HALF_W - 2));
        beginSetPiece(SP.FREE_KICK, 1 - p.team, spot);
        spIndirect = true;
    }

    // =====================================================================================
    //  Jogadas: cruzamento, enfiada, inversão, tabela
    // =====================================================================================

    boolean specialPlay(FPlayer c, int press, double u) {
        int linha = c.def.pos().linha;
        if (c.isGK() || c.holding) return false;
        double v = V(c.team, c.pos().z), off = offsideLine(c.team);
        // 1) linha de fundo / ala: cruzamento ou bola para trás da área
        if (u > 42 && Math.abs(v) > 10 && linha >= 1) {
            FPlayer tgt = null, cut = null; double bs = -1e9, bc = -1e9;
            for (FPlayer r : teams[c.team]) {
                if (r == c || r.isGK() || r.out) continue;
                double ru = U(c.team, r.pos().x), rv = V(c.team, r.pos().z);
                if (ru > 50 && Math.abs(rv) < 10 && ru <= off + 0.3) {
                    double s2 = r.st().fin() * 0.5 + r.st().forca() * 0.25 + Math.min(openness(r), 7) * 4 + rnd.nextGaussian() * 4;
                    if (s2 > bs) { bs = s2; tgt = r; }
                }
                if (ru > 42 && ru < 55 && Math.abs(rv) < 9 && openness(r) > 4.0) {
                    double s2 = r.st().fin() * 0.6 + openness(r) * 3;
                    if (s2 > bc) { bc = s2; cut = r; }
                }
            }
            if (u > 56 && cut != null && rnd.nextDouble() < 0.45) {
                carrier = null; cnt("bola_para_tras");
                Vec3 ld = lead(cut, 8); kickGround(c, ld.x, ld.z, 0.9); passTarget = cut; passTtl = 60; markOffside(c);
                return true;
            }
            if (tgt != null && rnd.nextDouble() < 0.35 + c.st().vis() * 0.004 + (u > 52 ? 0.2 : 0)) {
                carrier = null; cnt("cruzamento"); if (nar != null) nar.cross();
                if (rnd.nextDouble() < 0.3) { Vec3 ld = lead(tgt, 10); kickGround(c, ld.x, ld.z, 1.0); }
                else {
                    Vec3 gc = W(c.team, 64, 0);
                    double cross = (tgt.pos().x - c.pos().x) * (gc.z - c.pos().z) - (tgt.pos().z - c.pos().z) * (gc.x - c.pos().x);
                    double d = hd(c.pos(), tgt.pos());
                    kickLob(c, tgt.pos().x, tgt.pos().z, (int) clamp(14 + d * 0.8, 16, 30), 1.5, Math.signum(cross) * (0.18 + (c.st().pas() - 50) * 0.003));
                }
                passTarget = tgt; passTtl = 70; markOffside(c);
                return true;
            }
        }
        // 2) enfiada: bola em profundidade para quem corre nas costas da zaga
        if (linha >= 1 && c.st().pas() >= 62 && u < 54 && rnd.nextDouble() < 0.09 + (c.st().vis() - 60) * 0.002) {
            FPlayer best = null; double bs = -1e9; Vec3 bp = null;
            for (FPlayer r : teams[c.team]) {
                if (r == c || r.isGK() || r.out || r.def.pos().linha < 3 && r.def.pos() != Pos.WG) continue;
                double ru = U(c.team, r.pos().x);
                if (ru < u + 10 || ru > off + 0.3) continue;
                Vec3 P = W(c.team, Math.min(62, ru + 9), V(c.team, r.pos().z));
                double lane = laneClear(c, P.x, P.z);
                double s2 = lane * 3 + Math.min(openness(r), 7) * 2 + (r.st().vel() - 50) * 0.1;
                if (lane > 1.5 && s2 > bs) { bs = s2; best = r; bp = P; }
            }
            if (best != null) {
                carrier = null; cnt("enfiada"); if (nar != null) nar.through(best);
                kickGround(c, bp.x, bp.z, 1.0); passTarget = best; passTtl = 80; markOffside(c);
                return true;
            }
        }
        // 3) inversão de jogo para o lado oposto
        if (press >= 1 && c.st().pas() >= 66 && linha >= 1 && rnd.nextDouble() < 0.3) {
            FPlayer best = null; double bs = -1e9;
            for (FPlayer r : teams[c.team]) {
                if (r == c || r.isGK() || r.out) continue;
                double rv = V(c.team, r.pos().z), ru = U(c.team, r.pos().x), d = hd(c.pos(), r.pos());
                if (Math.abs(rv - v) < 24 || d > 58 || ru < u - 6 || ru > off + 0.3) continue;
                double s2 = Math.min(openness(r), 9) * 3 + (ru - u) * 0.2;
                if (s2 > bs && openness(r) > 6.5) { bs = s2; best = r; }
            }
            if (best != null) {
                carrier = null; cnt("inversao"); if (nar != null) nar.switchPlay();
                Vec3 ld = lead(best, 12); double d = hd(c.pos(), best.pos());
                kickLob(c, ld.x, ld.z, (int) clamp(18 + d * 0.5, 22, 34), 2.0, Math.signum(rnd.nextGaussian()) * 0.12);
                passTarget = best; passTtl = 80; markOffside(c);
                return true;
            }
        }
        return false;
    }

    // =====================================================================================
    //  Decisão do jogador com a bola
    // =====================================================================================

    /** Linha de impedimento do ataque do time t (em u do time t). */
    double offsideLine(int t) {
        double a = -1, b = -1;
        for (FPlayer o : teams[1 - t]) {
            if (o.out) continue;
            double u = 64 - U(1 - t, o.pos().x);
            if (u > a) { b = a; a = u; } else if (u > b) b = u;
        }
        double ballU = U(t, refBall().x);
        return Math.max(Math.max(b, ballU), 32);
    }

    Vec3 refBall() { return st == St.SETPIECE ? spSpot : bp(); }

    /** Segmento passa perto de algum adversário? */
    double laneClear(FPlayer from, double tx, double tz) {
        double ax = from.pos().x, az = from.pos().z, dx = tx - ax, dz = tz - az, len2 = dx * dx + dz * dz + 1e-6;
        double min = 9;
        for (FPlayer o : teams[1 - from.team]) {
            double t = clamp(((o.pos().x - ax) * dx + (o.pos().z - az) * dz) / len2, 0, 1);
            if (t < 0.12) continue;
            double d = hd(o.pos().x, o.pos().z, ax + dx * t, az + dz * t);
            if (d < min) min = d;
        }
        return min;
    }

    /** Melhor companheiro para passar. forward = libera lançamentos; dmin/dmax em blocos. */
    FPlayer bestPass(FPlayer c, boolean allowGK, double dmin, double dmax, boolean safe) {
        dmin *= Pitch.SL; dmax *= Pitch.SL;
        FPlayer best = null; double bs = -1e9;
        double cu = U(c.team, c.pos().x), off = offsideLine(c.team);
        boolean def = c.def.pos().linha <= 1, mid = c.def.pos().linha == 2;
        int press = pressure(c, 3.2);
        for (FPlayer r : teams[c.team]) {
            if (r == c || r.out) continue;
            if (r.isGK() && (!allowGK || c.isGK())) continue;
            double d = hd(c.pos(), r.pos());
            if (d < dmin || d > dmax) continue;
            double ru = U(c.team, r.pos().x);
            if (ru > off + 0.3 && ru > cu) continue;                       // impedimento
            double open = openness(r);
            double lane = laneClear(c, r.pos().x, r.pos().z);
            double prog = (ru - cu);
            double w = def ? 0.30 : mid ? 0.45 : 0.65;
            if (safe) w *= 0.4;
            double s = prog * w + Math.min(open, 7) * 2.3 + Math.min(lane, 4) * (3.0 + (mid ? 1.5 : 0))
                    - Math.max(0, d - 22 * Pitch.SL) * (0.6 - c.st().pas() * 0.004)
                    + (r.def.pos().linha == 3 ? 3 : 0) + (r.isGK() ? -8 : 0)
                    + rnd.nextGaussian() * (2.5 - c.st().vis() * 0.02);
            if (r.giveGoTicks > 0 && r.giveGoTarget == c && prog > -3) s += 16;
            if (lane < 1.1 && d < 24 * Pitch.SL) s -= 14;                              // linha de passe bloqueada
            if (prog < 0 && cu > 24 && !safe) {                           // no ataque não se recua a bola sem pressão forte
                if (press < 3 && prog < -6) continue;
                s -= 14 + (-prog) * 0.8;
            } else if (press >= 3 && prog < 0) s += 2;
            else if (prog < -2 && !safe) s -= 4;
            if (prog > 3 && !safe) s += 2.5;                              // sob pressão aceita recuar
            if (s > bs) { bs = s; best = r; }
        }
        lastPassScore = bs;
        return best;
    }
    double lastPassScore;

    void carrierThink() {
        FPlayer c = carrier;
        if (c == null || c.holding) return;
        if (c.skillTicks > 0) return;
        if (c.ctrlTicks < 10 + (100 - c.st().vis()) / 9 || tickCount % 3 != 0) return;
        if (trySkill(c, pressure(c, 3.0))) return;
        Vec3 goal = W(c.team, 64, 0);
        double dGoal = hd(c.pos(), goal);
        double u = U(c.team, c.pos().x);
        int press = pressure(c, 3.0);
        int linha = c.def.pos().linha;
        FPlayer g = gk(1 - c.team);

        // 1) finalização
        double range = (13 + c.st().fin() * 0.17) * Pitch.SL;
        double bias = linha == 3 ? 1.0 : linha == 2 ? 0.55 : 0.12;
        double lane = laneClear(c, goal.x, goal.z);
        if (dGoal < range && !c.isGK() && Math.abs(V(c.team, c.pos().z)) < 17) {
            boolean must = dGoal < 9 * Pitch.SL;
            boolean free = lane > 1.0 || press >= 1 && dGoal < 15 * Pitch.SL;
            if ((must && rnd.nextDouble() < 0.9) || (free && rnd.nextDouble() < bias * (0.8 + c.st().fin() * 0.004))) {
                carrier = null; shoot(c, 1.0); return;
            }
        }
        if (specialPlay(c, press, u)) return;
        // 2) passe
        boolean ownThird = u < 20;
        FPlayer r = bestPass(c, ownThird && press >= 1, 4, c.st().pas() > 70 ? 36 : 28, false);
        double passScore = r != null ? lastPassScore : -99;
        // 3) condução
        double open = openness(c);
        double carryScore = (open > 3.5 ? 6 : open * 1.5) + c.st().dri() * 0.06 + (linha == 3 ? 5 : linha == 2 ? 1 : -6) - press * 2.5;
        if (u > 52) carryScore += 4;
        if (ownThird && press >= 2 && c.def.pos().linha == 1) {
            // limpa a área
            carrier = null;
            Vec3 tg = W(c.team, Math.min(58, u + 26), (c.pos().z > pitch.cz() ? 1 : -1) * attackDir[c.team] * 15);
            kickLob(c, tg.x, tg.z, 24, 4);
            return;
        }
        double passU = r != null ? U(c.team, r.pos().x) : 0;
        if (r != null && passU < u - 1 && u > 28 && press < 3) passScore -= 12;             // recuo no ataque: só se não houver nada melhor
        if (r != null && passScore > carryScore - 3 + (c.ctrlTicks > 40 ? 9 : 0)) {
            carrier = null;
            double d = hd(c.pos(), r.pos());
            boolean air = laneClear(c, r.pos().x, r.pos().z) < 1.2 && d > 15 * Pitch.SL || d > 42;
            kickPass(c, r, air);
        }
    }

    // =====================================================================================
    //  IA coletiva: posicionamento, pressão, marcação, apoio
    // =====================================================================================

    void aiTeam(int t) {
        FPlayer[] team = teams[t];
        Vec3 rb = refBall();
        boolean setp = st == St.SETPIECE;
        boolean own = carrier != null && carrier.team == t;
        boolean opp = carrier != null && carrier.team != t;
        boolean poss = setp ? spTeam == t : (own || (carrier == null && lastTouchTeam == t));
        double bu = U(t, rb.x), bv = V(t, rb.z);

        // quem pressiona / persegue
        FPlayer chaser = null, chaser2 = null;
        if (!setp && !own) {
            double b1 = 1e9, b2 = 1e9;
            Vec3 tgt = opp ? carrier.pos() : interceptOf(null);
            for (FPlayer p : team) {
                if (p.isGK() || p.out) continue;
                if (p.def.pos().linha == 1 && U(t, tgt.x) > 36 && p.def.pos() == Pos.CB) continue;
                if (p.def.pos().linha == 1 && U(t, tgt.x) > 46) continue;
                double tt = ttb(p, tgt);
                if (tt < b1) { b2 = b1; chaser2 = chaser; b1 = tt; chaser = p; } else if (tt < b2) { b2 = tt; chaser2 = p; }
            }
            if (chaser2 != null && counterPress[t] == 0 && (b2 > b1 + 22 || (!opp && chaser2.def.pos().linha < 2))) chaser2 = null;
        }
        double off = offsideLine(t);

        for (FPlayer p : team) {
            Pos pos = p.def.pos();
            if (p.out) { Vec3 bs = benchSpot(p); p.tx = bs.x; p.tz = bs.z; p.spd = 0.5; p.mode = FPlayer.Mode.HOLD; continue; }
            if (p.isGK()) { gkThink(p); continue; }
            if (p == spTaker && setp) continue;
            // posição base (formação dinâmica)
            double bk = pos.linha == 1 ? 0.42 : pos.linha == 2 ? 0.58 : 0.64;
            double u = p.def.u() + (bu - 32) * bk + (poss ? (pos.linha == 1 ? 5 : pos.linha == 2 ? 7 : 9) : (pos.linha == 3 ? -5 : 0));
            double v = p.def.v() * (poss ? 1.0 : 0.82);
            v += (bv - v) * (poss ? 0.18 : 0.30);
            double lo = pos.linha == 1 ? 6 : pos.linha == 2 ? 12 : 22, hi = pos.linha == 1 ? 42 : pos.linha == 2 ? 54 : 60;
            u = clamp(u, lo, hi);
            if (!poss && pos.linha >= 2) u = Math.min(u, Math.max(bu + 4, 16));
            FPlayer.Mode mode = FPlayer.Mode.HOLD;
            double spd = 0.55;

            if (pos.linha == 3 || (pos == Pos.WG)) {
                u = Math.min(u, off - 0.7);
                if (poss && bu > 38) {                                      // ataque à área
                    u = Math.min(off - 0.7, pos == Pos.WG ? 61 : 58);
                    if (pos == Pos.ST) v = clamp(bv * 0.3 + p.def.v() * 0.5, -6, 6);
                    if (pos == Pos.SS) v = clamp(-bv * 0.2 + p.def.v(), -9, 9);
                    if (pos == Pos.WG) v = Math.signum(p.def.v()) * 15;
                    spd = 0.85; mode = FPlayer.Mode.RUN;
                }
            }
            if (pos == Pos.FB && poss && bu > 28 && Math.signum(bv) == Math.signum(p.def.v())) {   // lateral apoia
                u = Math.min(bu - 1, 52); v = Math.signum(p.def.v()) * 17; spd = 0.8; mode = FPlayer.Mode.RUN;
            }
            if (pos == Pos.DM) u = Math.min(u, bu - 6);
            // ---- inteligência específica por posição ----
            boolean build = own && carrier != null && U(t, carrier.pos().x) < 28;
            if (pos.linha == 1) {                                     // linha defensiva coordenada
                double line = clamp(14 + (bu - 32) * 0.42 + (poss ? 5 : -1), 8, 42);
                if (poss && bu > 40) line = Math.min(line, 34);           // defesa de espera: não sobe demais
                if (counterPress[t] > 0 || trans[1 - t] > 0) line = Math.min(line, 24);   // recomposição
                u = clamp(line + (p.def.u() - 12.5) * 0.6, lo, hi);
                if (pos == Pos.FB && poss && Math.signum(bv) != Math.signum(p.def.v()) && Math.abs(bv) > 6) v *= 0.45;  // lateral oposto fecha por dentro
            }
            if (pos == Pos.DM && build) { u = Math.min(u, 18); v = clamp(bv * 0.4, -6, 6); spd = 0.7; }     // volante recua entre os zagueiros
            if (pos == Pos.DM && poss && bu > 40) u = Math.min(u, 34);                                      // cobertura
            if (pos == Pos.CM && poss && bu > 36) { u = Math.min(off - 2, 52); v = clamp(bv * 0.5 + p.def.v() * 0.6, -9, 9); spd = 0.85; mode = FPlayer.Mode.RUN; }  // chega de segunda linha
            if (pos == Pos.WG) {
                boolean sameFlank = Math.signum(bv) == Math.signum(p.def.v());
                if (poss && !sameFlank && Math.abs(bv) > 8 && bu > 28) v = Math.signum(p.def.v()) * 7;     // infiltra por dentro
                if (!poss && sameFlank && bu < 36 && carrier != null) { u = Math.max(14, bu - 2); spd = 0.8; mode = FPlayer.Mode.MARK; }   // recompõe ajudando o lateral
            }
            if ((pos.linha == 3 || pos == Pos.WG) && trans[t] > 0 && !setp) { u = Math.min(off - 0.7, u + 8); spd = 1.0; mode = FPlayer.Mode.RUN; }  // contra-ataque
            if (pos == Pos.FB && trans[t] > 0 && !setp) { u = Math.min(bu + 2, 46); spd = 0.95; }
            if (pos == Pos.ST && poss && bu > 24 && bu < 40 && carrier != null && carrier.def.pos().linha == 2 && (tickCount / 240 + p.def.num()) % 3 == 0) {
                u = Math.min(off - 0.7, bu + 7); spd = 0.8;                                                // pivô: desce para tabelar
            }
            Vec3 tgtW = W(t, u, v);
            double tx = tgtW.x, tz = tgtW.z;

            if (own && p == carrier) {
                if (p.skillTicks > 0) {
                    double sx = -p.skillFz * p.skillSide, sz = p.skillFx * p.skillSide;       // lateral da finta
                    if (p.skillTicks > p.skillSplit) { tx = p.pos().x + sx * 2.8 + p.skillFx * 0.5; tz = p.pos().z + sz * 2.8 + p.skillFz * 0.5; }
                    else {
                        double a = -p.skillSide * 0.9, ca = Math.cos(a), sa = Math.sin(a);
                        tx = p.pos().x + (p.skillFx * ca - p.skillFz * sa) * 6; tz = p.pos().z + (p.skillFx * sa + p.skillFz * ca) * 6;
                        p.boost = 1.22;
                    }
                    spd = 1.0; mode = FPlayer.Mode.CARRY;
                } else {
                    // conduzir
                    Vec3 goal = W(t, 64, 0);
                    Vec3 dir = carryDir(p, goal);
                    tx = p.pos().x + dir.x * 6; tz = p.pos().z + dir.z * 6;
                    spd = pos.linha >= 2 ? 0.92 : 0.7; mode = FPlayer.Mode.CARRY;
                }
            } else if (own) {
                // apoio: os dois mais próximos oferecem linha de passe
                double dc = hd(p.pos(), carrier.pos());
                if (pos.linha >= 2 && dc < 16 * Pitch.SL && pos != Pos.ST) {
                    Vec3 sup = supportSpot(p, carrier, off);
                    tx = tx * 0.4 + sup.x * 0.6; tz = tz * 0.4 + sup.z * 0.6; spd = 0.7; mode = FPlayer.Mode.RUN;
                }
            } else if (setp) {
                Vec3 sp2 = setPieceTarget(p, t);
                tx = sp2.x; tz = sp2.z; spd = 0.75; mode = FPlayer.Mode.SETPIECE;
            } else if (carrier == null) {
                // bola solta
                if (p == passTarget && passTarget.team == t) {
                    Vec3 ip = interceptOf(p);
                    tx = ip.x; tz = ip.z; spd = 1.0; mode = FPlayer.Mode.RECEIVE;
                } else if (p == chaser || (p == chaser2 && !poss)) {
                    Vec3 ip = interceptOf(p);
                    tx = ip.x; tz = ip.z; spd = 1.0; mode = FPlayer.Mode.CHASE;
                }
            } else if (opp) {
                Vec3 cp = carrier.pos();
                if (p == chaser) {                                          // pressiona o portador
                    double ahead = 0.5 + 0.9 * (1 - p.st().agr() / 100.0);
                    tx = cp.x + carrier.fx * ahead * 0.5; tz = cp.z + carrier.fz * ahead * 0.5;
                    spd = hd(p.pos(), cp) > 3 ? 1.0 : 0.85; mode = FPlayer.Mode.PRESS;
                    if (hd(p.pos(), cp) < 1.6 || p.st().agr() > 75) { tx = cp.x; tz = cp.z; }
                } else if (p == chaser2) {                                  // dobra / cobertura
                    Vec3 og = W(t, 0, 0);
                    double dx = og.x - cp.x, dz = og.z - cp.z, d = Math.max(1, Math.hypot(dx, dz));
                    tx = cp.x + dx / d * 3.5; tz = cp.z + dz / d * 3.5; spd = 0.9; mode = FPlayer.Mode.MARK;
                } else if (pos.linha >= 1) {
                    // marcação: adversário mais perigoso da minha zona, ficando do lado do gol
                    FPlayer m = markTarget(p);
                    if (m != null) {
                        Vec3 og = W(t, 0, 0);
                        double dx = og.x - m.pos().x, dz = og.z - m.pos().z, d = Math.max(1, Math.hypot(dx, dz));
                        double tight = 2.5 - 1.4 * (p.st().agr() / 100.0) - (pos == Pos.CB ? 0.2 : 0);
                        double mk = pos.linha == 1 ? 0.75 : 0.5;
                        tx = tx * (1 - mk) + (m.pos().x + dx / d * tight) * mk;
                        tz = tz * (1 - mk) + (m.pos().z + dz / d * tight) * mk;
                        mode = FPlayer.Mode.MARK; spd = 0.75;
                    }
                }
            }
            if (mode == FPlayer.Mode.HOLD && !setp) {                      // sem bola: movimentação sutil, nada de estátua
                if (--p.swTicks <= 0) { p.swTicks = 50 + rnd.nextInt(80); p.swX = rnd.nextGaussian() * 1.7; p.swZ = rnd.nextGaussian() * 1.7; }
                tx += p.swX; tz += p.swZ; spd = 0.45;
            }
            if (p.giveGoTicks > 0 && p.giveGoTarget != null && carrier == p.giveGoTarget && own) {        // tabela: corre para receber de volta
                Vec3 w = W(t, Math.min(off - 0.7, U(t, carrier.pos().x) + 11), V(t, carrier.pos().z) + (p.def.v() >= 0 ? 7 : -7));
                tx = w.x; tz = w.z; spd = 1.0; mode = FPlayer.Mode.RUN;
            }
            // regras de reposição (distância / áreas)
            if (setp) { Vec3 c = enforceSetPiece(p, t, tx, tz); tx = c.x; tz = c.z; }
            // limites do campo
            p.tx = clamp(tx, pitch.cx() - Pitch.HALF_L + 0.6, pitch.cx() + Pitch.HALF_L - 0.6);
            p.tz = clamp(tz, pitch.cz() - Pitch.HALF_W + 0.6, pitch.cz() + Pitch.HALF_W - 0.6);
            p.spd = spd; p.mode = mode;
        }
    }

    FPlayer markTarget(FPlayer p) {
        FPlayer best = null; double bs = 1e9;
        Vec3 anchor = W(p.team, p.def.u(), p.def.v());
        for (FPlayer o : teams[1 - p.team]) {
            if (o.isGK() || o == carrier || o.out) continue;
            double d = hd(anchor.x, anchor.z, o.pos().x, o.pos().z);
            double ou = U(p.team, o.pos().x);
            if (ou > U(p.team, anchor.x) + 18) continue;
            double s = d + (o.def.pos().linha == 3 ? -4 : 0);
            if (s < bs && d < 17) { bs = s; best = o; }
        }
        return best;
    }

    Vec3 carryDir(FPlayer p, Vec3 goal) {
        double gx = goal.x - p.pos().x, gz = goal.z - p.pos().z, gd = Math.max(1, Math.hypot(gx, gz));
        gx /= gd; gz /= gd;
        double best = -1e9; Vec3 bd = new Vec3(gx, 0, gz);
        for (int i = -3; i <= 3; i++) {
            double a = Math.toRadians(i * 28);
            double dx = gx * Math.cos(a) - gz * Math.sin(a), dz = gx * Math.sin(a) + gz * Math.cos(a);
            double px = p.pos().x + dx * 5, pz = p.pos().z + dz * 5;
            double s = (dx * gx + dz * gz) * 4 + Math.min(openAt(px, pz, p.team), 6) * 1.6;
            if (Math.abs(pz - pitch.cz()) > Pitch.HALF_W - 1.5) s -= 6;
            if (s > best) { best = s; bd = new Vec3(dx, 0, dz); }
        }
        return bd;
    }

    Vec3 supportSpot(FPlayer p, FPlayer c, double off) {
        Vec3 best = p.pos(); double bs = -1e9;
        double cu = U(p.team, c.pos().x), cv = V(p.team, c.pos().z);
        for (int i = 0; i < 6; i++) {
            double ang = i * Math.PI / 3;
            double du = Math.cos(ang) * 9 + (p.def.pos().linha == 3 ? 3 : 0), dv = Math.sin(ang) * 10;
            double u = clamp(cu + du, 8, Math.min(off - 0.7, 60)), v = clamp(cv + dv, -17, 17);
            Vec3 w = W(p.team, u, v);
            double s = Math.min(openAt(w.x, w.z, p.team), 7) * 2 + Math.min(laneClear(c, w.x, w.z), 4) * 3 - hd(p.pos().x, p.pos().z, w.x, w.z) * 0.15 + (u - cu) * 0.15;
            if (s > bs) { bs = s; best = w; }
        }
        return best;
    }

    double ttb(FPlayer p, Vec3 pt) { return hd(p.pos(), pt) / Math.max(0.05, p.maxSpeed() * 0.92) + (p.stun > 0 ? 10 : 0); }

    /** Ponto de interceptação da bola solta (p == null: ponto para estimativa genérica). */
    Vec3 interceptOf(FPlayer p) {
        if (carrier != null && p == null) return carrier.pos();
        if (p == null) return traj[Math.min(8, traj.length - 1)];
        double vmax = p.maxSpeed() * 0.95;
        for (int n = 0; n < traj.length; n++) {
            Vec3 q = traj[n];
            if (q.y - pitch.surf() > 2.4) continue;
            if (hd(p.pos(), q) - 0.7 <= vmax * n) return q;
        }
        return traj[traj.length - 1];
    }

    void gkThink(FPlayer g) {
        int t = g.team;
        if (g.holding) { g.tx = g.pos().x; g.tz = g.pos().z; g.spd = 0; g.mode = FPlayer.Mode.GK; return; }
        Vec3 rb = refBall();
        double bu = U(t, rb.x), bv = V(t, rb.z);
        g.mode = FPlayer.Mode.GK;
        if (g.shotActive) {
            // mergulho: vai ao ponto previsto na linha do gol
            if (g.shotTicks >= g.shotReact) {
                Vec3 tg = W(t, 0.9, V(t, g.aimZ));
                g.tx = tg.x; g.tz = tg.z; g.spd = 1.6;
                if (!g.jumped && g.aimY > 1.5 && g.shotTicks >= g.shotReact + 1 && hd(g.pos(), bp()) < 5.5) {
                    g.e.setDeltaMovement(g.e.getDeltaMovement().x, 0.42 + g.st().ref() * 0.001, g.e.getDeltaMovement().z);
                    g.jumped = true;
                }
            } else { g.tx = g.pos().x; g.tz = g.pos().z; g.spd = 0; }
            return;
        }
        boolean inBox = bu < Pitch.BOXV_D && Math.abs(bv) < Pitch.BOXV_H;
        if (st == St.PLAYING && inBox && carrier == null && bh() < 1.6 && ballSlowish()) {
            // sair para pegar se for o mais perto
            double mine = ttb(g, bp()); boolean first = true;
            for (FPlayer o : all) if (o != g && !o.isGK() && ttb(o, bp()) < mine * 0.85) first = false;
            if (first && !(lastToucher != null && lastToucher.team == t && lastToucher != g)) {
                Vec3 ip = interceptOf(g); g.tx = ip.x; g.tz = ip.z; g.spd = 1.0; return;
            }
        }
        // 1x1: fecha o ângulo saindo ao encontro do atacante
        if (st == St.PLAYING && carrier != null && carrier.team != t && bu < 22 && Math.abs(bv) < 12 && !g.holding) {
            double dist1 = Math.hypot(bu, bv);
            double rr = clamp(dist1 * (0.28 + g.st().vis() * 0.0015), 2.0, 7.0);
            Vec3 w1 = W(t, Math.max(1.2, rr * bu / dist1), clamp(rr * bv / dist1, -3.2, 3.2));
            g.tx = w1.x; g.tz = w1.z; g.spd = 0.95; return;
        }
        // bola nas costas da defesa: sai para tirar de antecipação
        if (st == St.PLAYING && carrier == null && bu > 6 && bu < 30 && Math.abs(bv) < 14 && bh() < 1.6 && !(lastToucher != null && lastToucher.team == t && lastToucher != g)) {
            Vec3 ip = interceptOf(g);
            double mine = ttb(g, ip); boolean first = true;
            for (FPlayer o : all) if (o != g && !o.isGK() && o.team != t && ttb(o, ip) < mine * 1.0) first = false;
            if (first && U(t, ip.x) < 28) { g.tx = ip.x; g.tz = ip.z; g.spd = 1.0; return; }
        }
        // goleiro-líbero: sobe a linha quando o time está com a bola no campo de ataque
        boolean possT = carrier != null ? carrier.team == t : lastTouchTeam == t;
        double sweep = (st == St.PLAYING && possT && bu > 36) ? clamp((bu - 30) * 0.25, 0, 7) : 0;
        // posicionamento na bissetriz
        double dist = Math.max(1, Math.hypot(bu, bv));
        double r = clamp(1.3 + dist * 0.05, 1.3, 3.6) + sweep;
        if (st == St.SETPIECE && sp == SP.PENALTY) r = 0.8;
        double u = r * bu / dist, v = clamp(r * bv / dist, -2.9, 2.9);
        Vec3 w = W(t, Math.max(0.8, u), v);
        g.tx = w.x; g.tz = w.z; g.spd = 0.8;
    }

    boolean ballSlowish() { Vec3 v = ball.getDeltaMovement(); return Math.hypot(v.x, v.z) < 0.55; }

    // ---- reposições: posicionamento de quem não bate ----

    Vec3 setPieceTarget(FPlayer p, int t) {
        Pos pos = p.def.pos();
        boolean atk = t == spTeam;
        switch (sp) {
            case CORNER -> {
                if (atk) {
                    if (pos == Pos.ST || pos == Pos.SS || pos == Pos.CB || pos == Pos.DM || pos == Pos.CM) {
                        int slot = (p.def.num() * 7) % 5;
                        double[][] spots = {{57, 3}, {55, -3}, {58, 7}, {54, 0}, {58, -6}};
                        return W(t, spots[slot][0], spots[slot][1] * (Math.signum(V(t, spSpot.z)) < 0 ? -1 : 1));
                    }
                    return W(t, 40, p.def.v() * 0.5);
                } else {
                    double[][] spots = {{61, 1.5}, {60, -1.5}, {57, 4}, {56, -4}, {58, 0}, {54, 7}};
                    int slot = Math.floorMod(p.def.num(), 6);
                    if (pos.linha >= 1 && pos != Pos.WG && pos != Pos.ST) return W(t, 64 - spots[slot][0], spots[slot][1]);
                    return W(t, 40, p.def.v() * 0.6);
                }
            }
            case FREE_KICK -> {
                Vec3 gc = W(spTeam, 64, 0);
                double dG = hd(spSpot, gc);
                if (atk) {
                    if (dG < 34 * Pitch.SL && (pos == Pos.ST || pos == Pos.SS || pos == Pos.CB || pos == Pos.DM)) {
                        double[][] spots = {{58, 4}, {57, -4}, {54, 8}, {54, -8}};
                        int slot = Math.floorMod(p.def.num(), 4);
                        return W(t, spots[slot][0], spots[slot][1]);
                    }
                    return W(t, p.def.u(), p.def.v());
                }
                if (dG < 30 * Pitch.SL) {                              // barreira de 3 jogadores a 9 m
                    java.util.List<FPlayer> cand = new java.util.ArrayList<>();
                    for (FPlayer q : teams[t]) if (!q.isGK() && !q.out) cand.add(q);
                    cand.sort(java.util.Comparator.comparingDouble(q -> hd(q.pos(), spSpot)));
                    int rank = cand.indexOf(p);
                    if (rank >= 0 && rank < 3) {
                        double dx = gc.x - spSpot.x, dz = gc.z - spSpot.z, dn = Math.max(0.1, Math.hypot(dx, dz));
                        dx /= dn; dz /= dn;
                        double cx = spSpot.x + dx * 7.9, cz = spSpot.z + dz * 7.9;
                        return new Vec3(cx - dz * (rank - 1) * 0.95, 0, cz + dx * (rank - 1) * 0.95);
                    }
                }
                return W(t, p.def.u(), p.def.v());
            }
            case PENALTY -> {
                // todos fora da grande área, atrás da marca
                if (atk) return W(t, 64 - Pitch.BOXV_D - 3, p.def.v());
                return W(t, Pitch.BOXV_D + 3, p.def.v());
            }
            default -> { return W(t, p.def.u(), p.def.v()); }
        }
    }

    /** Aplica regras: adversário a 6,5 m da bola, no kickoff fora do círculo e na própria metade. */
    Vec3 enforceSetPiece(FPlayer p, int t, double tx, double tz) {
        double minD = sp == SP.KICKOFF ? 7.4 : sp == SP.THROW_IN ? 3.5 : sp == SP.FREE_KICK ? 7.6 : (sp == SP.GOAL_KICK ? 10.0 : 8.0);
        if (t != spTeam) {
            double dx = tx - spSpot.x, dz = tz - spSpot.z, d = Math.hypot(dx, dz);
            if (d < minD) {
                if (d < 0.01) { dx = attackDir[t]; dz = 0; d = 1; }
                tx = spSpot.x + dx / d * minD; tz = spSpot.z + dz / d * minD;
            }
        }
        if (sp == SP.KICKOFF) {
            double u = U(t, tx);
            if (u > 31) { Vec3 w = W(t, 31, V(t, tz)); tx = w.x; tz = w.z; }
        }
        if (sp == SP.GOAL_KICK && t != spTeam) {          // adversário fora da grande área
            double u = U(t, tx), v = Math.abs(V(t, tz));
            double ou = 64 - u;
            if (ou < Pitch.BOXV_D + 1 && v < Pitch.BOXV_H + 1) { Vec3 w = W(t, 64 - Pitch.BOXV_D - 2, V(t, tz)); tx = w.x; tz = w.z; }
        }
        return new Vec3(tx, 0, tz);
    }

    // =====================================================================================
    //  Movimento
    // =====================================================================================

    void step(FPlayer p) {
        Mob e = p.e;
        Vec3 pos = e.position();
        double dx = p.tx - pos.x, dz = p.tz - pos.z, d = Math.hypot(dx, dz);
        double vmax = p.maxSpeed();
        double frac = p.spd;
        if (frac > 1.0) vmax *= frac;       // goleiro em mergulho
        else vmax *= clamp(frac, 0, 1);
        if (carrier == p && !p.isGK()) vmax *= 0.86 + p.st().dri() * 0.0013;
        vmax *= p.boost;
        double want = Math.min(vmax, d * 0.22);
        if (d < 0.12) want = 0;
        double wx = d > 1e-6 ? dx / d * want : 0, wz = d > 1e-6 ? dz / d * want : 0;
        // separação
        for (FPlayer o : all) {
            if (o == p) continue;
            double sx = pos.x - o.e.getX(), sz = pos.z - o.e.getZ(), sd = Math.hypot(sx, sz);
            if (sd < 1.15 && sd > 0.001) { double k = (1.15 - sd) * 0.12; wx += sx / sd * k; wz += sz / sd * k; }
        }
        double a = p.accel() * (p.spd > 1.0 ? 3 : 1);
        double sp0 = Math.hypot(p.vx, p.vz), wm = Math.hypot(wx, wz);
        if (sp0 > 0.1 && wm > 0.05 && (wx * p.vx + wz * p.vz) / (sp0 * wm) < 0.3) { wx *= 0.6; wz *= 0.6; a *= 0.7; }   // mudança brusca de direção custa velocidade
        double ax = wx - p.vx, az = wz - p.vz, am = Math.hypot(ax, az);
        if (am > a) { ax = ax / am * a; az = az / am * a; }
        p.vx += ax; p.vz += az;
        e.setDeltaMovement(p.vx, e.getDeltaMovement().y, p.vz);
        // estamina
        double sp2 = Math.hypot(p.vx, p.vz);
        if (sp2 > p.maxSpeed() * 0.8) p.energy = Math.max(0.35, p.energy - 0.00022 * (1.7 - p.st().fol() / 100.0));
        else if (sp2 < p.maxSpeed() * 0.5) p.energy = Math.min(1.0, p.energy + 0.00035);
        // direção do olhar
        double lx, lz;
        if (st == St.INTRO && stTicks < 255 && d < 0.6 && sp2 < 0.06) { lx = 0; lz = 1; }
        else if (sp2 > 0.05) { lx = p.vx; lz = p.vz; }
        else { Vec3 b = bp(); lx = b.x - pos.x; lz = b.z - pos.z; }
        double ln = Math.hypot(lx, lz);
        if (ln > 1e-6) {
            lx /= ln; lz /= ln;
            p.fx += (lx - p.fx) * 0.35; p.fz += (lz - p.fz) * 0.35;
            double fn = Math.max(1e-6, Math.hypot(p.fx, p.fz)); p.fx /= fn; p.fz /= fn;
            float yaw = yawTo(p.fx, p.fz);
            e.setYRot(yaw); e.yBodyRot = yaw; e.setYHeadRot(yaw);
        }
    }


    // =====================================================================================
    //  Replays (gravação contínua dos últimos segundos + reprodução em câmera lenta)
    // =====================================================================================

    final java.util.ArrayDeque<double[]> rec = new java.util.ArrayDeque<>();
    int recCount, goalMark, chanceMark, lastShotTick, lastReplayEnd = -9999;
    boolean chancePending;
    public boolean replaysChance = true;
    public FPlayer foulVictim;

    void markChance() { chanceMark = recCount; chancePending = true; }
    public boolean replaysAuto = true;
    List<double[]> replayFrames = new ArrayList<>();
    double replayPos, replaySpeed = 0.5;
    public int replayIdx, replayLen;
    St replayPrev; int replayPrevTicks; double[] replayRestore; boolean replayWasPinned; Vec3 replayPin;

    double[] snapshot() {
        double[] f = new double[all.size() * 4 + 3];
        int i = 0;
        for (FPlayer p : all) { Vec3 q = p.e.position(); f[i++] = q.x; f[i++] = q.y; f[i++] = q.z; f[i++] = p.e.getYRot(); }
        Vec3 b = bp(); f[i++] = b.x; f[i++] = b.y; f[i] = b.z;
        return f;
    }

    void record() {
        rec.addLast(snapshot()); recCount++;
        if (rec.size() > 420) rec.pollFirst();
    }

    /** goal = true: termina um pouco depois do gol; senão, os últimos 'seconds' segundos. */
    public boolean startReplay(boolean goal, int seconds, double speed) { return startReplayCore(goal ? goalMark : -1, seconds, speed); }

    /** mark >= 0: lance marcado (termina logo depois dele); mark < 0: os últimos 'seconds' segundos. */
    boolean startReplayCore(int mark, int seconds, double speed) {
        boolean goal = mark >= 0;
        if (st == St.REPLAY || st == St.IDLE || rec.size() < 40) return false;
        List<double[]> all2 = new ArrayList<>(rec);
        int firstGlobal = recCount - all2.size();
        int end = all2.size(), start;
        if (goal) { end = Math.min(all2.size(), mark + 25 - firstGlobal); end = Math.max(end, 20); }
        start = Math.max(0, end - seconds * 20 - (goal ? 25 : 0));
        replayFrames = new ArrayList<>(all2.subList(start, end));
        if (replayFrames.size() < 20) return false;
        replayRestore = snapshot(); replayPrev = st; replayPrevTicks = stTicks;
        replayWasPinned = ballPinned; replayPin = pinPos;
        replayPos = 0; replaySpeed = speed; replayLen = replayFrames.size(); replayIdx = 0;
        st = St.REPLAY; stTicks = 0;
        if (cameras != null) cameras.forceAll(Cameras.Mode.AUTO);
        if (nar != null) nar.replay();
        FutebolMod.LOG.info("REPLAY iniciado: {} quadros, {}x", replayLen, speed);
        return true;
    }

    void tickReplay() {
        replayPos += replaySpeed;
        int i = (int) replayPos;
        if (i >= replayLen - 1) { endReplay(); return; }
        replayIdx = i;
        double fr = replayPos - i;
        double[] a = replayFrames.get(i), b = replayFrames.get(i + 1);
        int k = 0;
        for (FPlayer p : all) {
            double x = a[k] + (b[k] - a[k]) * fr, y = a[k + 1] + (b[k + 1] - a[k + 1]) * fr, z = a[k + 2] + (b[k + 2] - a[k + 2]) * fr;
            float yaw = (float) (a[k + 3] + Mth_wrap(b[k + 3] - a[k + 3]) * fr);
            k += 4;
            Vec3 cur = p.e.position();
            double dx = x - cur.x, dz = z - cur.z;
            if (Math.hypot(dx, dz) > 2.5 || Math.abs(y - cur.y) > 2) p.e.snapTo(x, y, z, yaw, 0);
            else p.e.setDeltaMovement(dx, p.e.onGround() ? Math.max(0, y - cur.y) : p.e.getDeltaMovement().y, dz);
            p.e.setYRot(yaw); p.e.yBodyRot = yaw; p.e.setYHeadRot(yaw);
            p.vx = p.vz = 0;
        }
        double bx = a[k] + (b[k] - a[k]) * fr, by = a[k + 1] + (b[k + 1] - a[k + 1]) * fr, bz = a[k + 2] + (b[k + 2] - a[k + 2]) * fr;
        pinBall(new Vec3(bx, by, bz));
        if (tickCount % 20 == 0) for (ServerPlayer pl : level.players()) pl.sendSystemMessage(Component.literal("§e▶ REPLAY"), true);
    }

    static double Mth_wrap(double d) { d %= 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; }

    void endReplay() {
        double[] f = replayRestore; int k = 0;
        for (FPlayer p : all) {
            p.e.snapTo(f[k], f[k + 1], f[k + 2], (float) f[k + 3], 0); k += 4;
            p.vx = p.vz = 0; p.tx = p.e.getX(); p.tz = p.e.getZ();
            p.e.setDeltaMovement(Vec3.ZERO);
        }
        ball.snapTo(f[k], f[k + 1], f[k + 2]); ball.setDeltaMovement(Vec3.ZERO);
        ballPinned = replayWasPinned; pinPos = replayPin; ballVelSet = Vec3.ZERO;
        st = replayPrev; stTicks = replayPrevTicks;
        if (cameras != null) cameras.releaseForced();
        lastReplayEnd = tickCount;
        FutebolMod.LOG.info("REPLAY terminou, voltando para {}", st);
    }

    // =====================================================================================
    //  Utilidades de apresentação
    // =====================================================================================

    String nome(int t) { return Roster.COR_CHAT[t] + Roster.TIME_NOME[t] + "§r"; }
    String placar() { return Roster.COR_CHAT[0] + Roster.TIME_NOME[0] + " §f" + score[0] + " x " + score[1] + " " + Roster.COR_CHAT[1] + Roster.TIME_NOME[1]; }

    /** Só aparece com /futebol info on. */
    public boolean verbose = false;
    void sayV(String s) { if (verbose) say(s); }

    void say(String s) {
        for (ServerPlayer pl : level.players()) pl.sendSystemMessage(Component.literal(s));
    }

    void title(String t, String sub) {
        for (ServerPlayer pl : level.players()) {
            pl.connection.send(new ClientboundSetTitlesAnimationPacket(5, 35, 10));
            pl.connection.send(new ClientboundSetSubtitleTextPacket(Component.literal(sub)));
            pl.connection.send(new ClientboundSetTitleTextPacket(Component.literal(t)));
        }
    }

    void whistle(float pitchMul) {
        Vec3 c = new Vec3(pitch.cx(), pitch.surf() + 2, pitch.cz());
        level.playSound(null, c.x, c.y, c.z, SoundEvents.NOTE_BLOCK_FLUTE.value(), SoundSource.NEUTRAL, 4f, 2.0f * pitchMul);
    }

    void hud() {
        int totalMin = (half == 1 ? 0 : 45) + (int) (45.0 * clock / halfLen);
        String tempo = st == St.IDLE ? "" : st == St.FULLTIME ? "fim" : String.format("%d'", Math.min(totalMin, 90));
        if (st != St.REPLAY && (verbose || st == St.IDLE)) {
            String txt = Roster.COR_CHAT[0] + Roster.SIGLA[0] + " §f" + score[0] + "-" + score[1] + " " + Roster.COR_CHAT[1] + Roster.SIGLA[1] + " §7" + tempo;
            for (ServerPlayer pl : level.players())
                if (hd(pl.position(), new Vec3(pitch.cx(), 0, pitch.cz())) < 160) pl.sendSystemMessage(Component.literal(st == St.IDLE ? "§7Botão direito com o graveto para apitar" : txt), true);
        }
        if (screens != null) screens.update(
            Roster.COR_CHAT[0] + "§l" + Roster.SIGLA[0] + " §f§l" + score[0] + " - " + score[1] + " " + Roster.COR_CHAT[1] + "§l" + Roster.SIGLA[1] + "\n§e" + tempo + "  §7| §fPúblico " + (crowd == null ? 0 : crowd.count * 410),
            "§6§l" + Roster.TIME_NOME[0] + " x " + Roster.TIME_NOME[1] + "\n§7" + boardInfo);
    }

    /** Graveto + agachar: volta tudo para o pontapé inicial (placar zerado). */
    public void stopToKickoff() {
        score[0] = score[1] = 0; half = 1; clock = 0; attackDir[0] = 1; attackDir[1] = -1;
        st = St.IDLE; stTicks = 0;
        resetForKickoff(0, true);
        sayV("§7Partida reiniciada.");
    }

    /** Jogador humano chuta a bola (botão esquerdo). */
    public void humanKick(net.minecraft.world.entity.player.Player pl) {
        if (st == St.IDLE || st == St.FULLTIME || st == St.GOAL || st == St.HALFTIME || st == St.REPLAY) return;
        if (st == St.SETPIECE) return;
        Vec3 look = pl.getLookAngle();
        double power = pl.isSprinting() ? 1.15 : 0.8;
        unpin();
        if (carrier != null) { carrier.touchCd = 15; carrier = null; }
        double hx = look.x, hz = look.z, hn = Math.max(1e-6, Math.hypot(hx, hz));
        ball.setDeltaMovement(hx / hn * power, 0.12 + Math.max(0, look.y) * 0.5, hz / hn * power);
        ballVelSet = ball.getDeltaMovement();
        lastTouchTeam = -1; lastToucher = null; passTarget = null;
        level.playSound(null, bp().x, bp().y, bp().z, SoundEvents.SULFUR_CUBE_BOUNCY_HIT, SoundSource.PLAYERS, 1.2f, 1f);
    }
}
