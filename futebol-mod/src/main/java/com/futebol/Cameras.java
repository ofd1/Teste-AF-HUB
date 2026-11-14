package com.futebol;

import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.decoration.ArmorStand;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Câmeras no estilo transmissão de TV. A câmera principal é um tripé FIXO que só gira (com atraso e zona morta, como
 * um operador de verdade); o diretor corta entre câmeras altas, atrás do gol, rasteira, spidercam, escanteio,
 * close-ups e torcida conforme o lance. Agache para sair.
 */
public final class Cameras {
    public enum Mode {
        AUTO("transmissao", "Transmissão (diretor)"),
        TV("principal", "Câmera 1 · principal"), ALTA("alta", "Câmera alta lateral"), GOL("gol", "Atrás do gol (alta)"),
        RASTEIRA("rasteira", "Rasteira na linha lateral"), SPIDER("spider", "Spidercam"), ESCANTEIO("escanteio", "Câmera do escanteio"),
        ROSTO("rosto", "Close do jogador"), TORCIDA("torcida", "Torcida"),
        TATICA("tatica", "Tática (de cima)"), BOLA("bola", "Câmera da bola"), JOGADOR("jogador", "Visão do jogador"),
        DRONE("drone", "Drone orbital"), ARQ("arquibancada", "Arquibancada");
        public final String id, nome;
        Mode(String id, String nome) { this.id = id; this.nome = nome; }
        public static Mode of(String s) {
            if (s.equals("auto")) return AUTO;
            if (s.equals("tv")) return TV;
            for (Mode m : values()) if (m.id.equals(s)) return m;
            return null;
        }
    }

    /** Enquadramento escolhido para este tick. */
    private record Shot(String key, Vec3 pos, Vec3 focus, double posAlpha, double panMax, double dead, double shake) {}

    private static final class Sess {
        Entity expect; int grace; ArmorStand cam; Mode mode; Vec3 pos = Vec3.ZERO; double yaw, pitch;
        String key = ""; int born; boolean forced; Mode prev; FPlayer followed;
    }

    private final Match m;
    private final Map<UUID, Sess> sess = new HashMap<>();
    private final ArrayDeque<Vec3> hist = new ArrayDeque<>();
    private int tick;

    // diretor
    private Mode dMode = Mode.TV; private int dEnd, dSide = 1; private FPlayer dSubject; private int dTeam;
    private Match.St dLastSt; private Match.SP dLastSp; private int dNextTrack = 1200;

    public Cameras(Match m) { this.m = m; }

    public boolean active(ServerPlayer pl) { return sess.containsKey(pl.getUUID()); }
    public Mode modeOf(ServerPlayer pl) { Sess s = sess.get(pl.getUUID()); return s == null ? null : s.mode; }

    // ------------------------------------------------------------------ sessões

    public void set(ServerPlayer pl, Mode mode) {
        Sess s = sess.get(pl.getUUID());
        if (s == null) {
            s = new Sess();
            s.cam = EntityTypes.ARMOR_STAND.create(m.level, EntitySpawnReason.COMMAND);
            s.cam.setInvisible(true); s.cam.setNoGravity(true); s.cam.setSilent(true); s.cam.setPermanentlyInvulnerable(true);
            s.cam.addTag("futebol");
            Vec3 p = pl.position();
            s.cam.snapTo(p.x, p.y, p.z);
            m.level.addFreshEntity(s.cam);
            s.pos = p.add(0, 1.6, 0);
            sess.put(pl.getUUID(), s);
        }
        s.mode = mode; s.key = ""; s.born = tick; s.forced = false;
        pl.setCamera(s.cam); s.expect = s.cam; s.grace = tick + 4; s.followed = null;
        pl.sendSystemMessage(Component.literal("§b🎥 " + mode.nome + " §7(agache para sair)"), true);
    }

    /** Transmissão para todos durante replays. */
    public void forceAll(Mode mode) {
        for (ServerPlayer pl : m.level.players()) {
            Sess s = sess.get(pl.getUUID());
            if (s == null) { set(pl, mode); s = sess.get(pl.getUUID()); s.forced = true; s.prev = null; }
            else if (!s.forced) { s.prev = s.mode; s.mode = mode; s.key = ""; s.forced = true; pl.setCamera(s.cam); s.expect = s.cam; s.grace = tick + 4; s.followed = null; }
        }
    }

    public void releaseForced() {
        for (ServerPlayer pl : new ArrayList<>(m.level.players())) {
            Sess s = sess.get(pl.getUUID());
            if (s == null || !s.forced) continue;
            if (s.prev != null) { s.mode = s.prev; s.prev = null; s.forced = false; s.key = ""; }
            else stop(pl);
        }
    }

    public void stop(ServerPlayer pl) {
        Sess s = sess.remove(pl.getUUID());
        if (s == null) return;
        if (pl.getCamera() != pl) pl.setCamera(pl);
        s.cam.discard();
    }

    public void stopAll() {
        for (ServerPlayer pl : new ArrayList<>(m.level.players())) stop(pl);
        for (Sess s : sess.values()) s.cam.discard();
        sess.clear();
    }

    public void tick() {
        tick++;
        hist.addLast(m.bp()); if (hist.size() > 9) hist.pollFirst();
        director();
        List<UUID> gone = new ArrayList<>();
        for (Map.Entry<UUID, Sess> en : sess.entrySet()) {
            ServerPlayer pl = m.level.getServer().getPlayerList().getPlayer(en.getKey());
            Sess s = en.getValue();
            if (pl == null || !pl.isAlive()) { s.cam.discard(); gone.add(en.getKey()); continue; }
            if (tick > s.grace && pl.getCamera() != s.expect) { s.cam.discard(); gone.add(en.getKey()); continue; }   // agachou: saiu
            update(pl, s);
        }
        gone.forEach(sess::remove);
    }

    // ------------------------------------------------------------------ diretor de TV

    private void cut(Mode mode, int hold) { dMode = mode; dEnd = tick + hold; }

    private int endOfBall() { return m.bp().x >= m.pitch.cx() ? 1 : -1; }

    private void director() {
        Match.St st = m.st;
        boolean changed = st != dLastSt || (st == Match.St.SETPIECE && m.sp != dLastSp);
        dLastSt = st; dLastSp = m.sp;
        if (!changed && tick < dEnd && st != Match.St.REPLAY && st != Match.St.GOAL && st != Match.St.SETPIECE) return;
        Vec3 b = m.bp();
        double bx = b.x - m.pitch.cx();
        switch (st) {
            case REPLAY -> {
                double f = m.replayIdx / (double) Math.max(1, m.replayLen);
                Mode want = f < 0.40 ? Mode.ALTA : f < 0.62 ? Mode.GOL : f < 0.82 ? Mode.RASTEIRA : Mode.ROSTO;
                if (want != dMode) { dMode = want; dEnd = tick + 20; dSubject = m.lastToucher; dSide = bx >= 0 ? 1 : -1; dEnd = tick; }
                dSubject = m.lastToucher;
            }
            case GOAL -> {
                dTeam = m.lastEventTeam < 0 ? 0 : m.lastEventTeam;
                if (m.stTicks < 55) { dMode = Mode.ROSTO; dSubject = m.lastToucher; }
                else if (m.stTicks < 105) dMode = Mode.TORCIDA;
                else dMode = Mode.ALTA;
            }
            case SETPIECE -> {
                int t = m.spTicks;
                switch (m.sp) {
                    case CORNER -> dMode = t < 75 ? Mode.ESCANTEIO : Mode.GOL;
                    case PENALTY -> {
                        if (t < 50) { dMode = Mode.ROSTO; dSubject = m.spTaker; }
                        else if (t < 85) { dMode = Mode.ROSTO; dSubject = m.gk(1 - m.spTeam); }
                        else dMode = Mode.GOL;
                    }
                    case FREE_KICK -> {
                        if (t < 55 && m.foulVictim != null) { dMode = Mode.ROSTO; dSubject = m.foulVictim; }
                        else dMode = Math.abs(bx) > 28 ? Mode.GOL : Mode.ALTA;
                    }
                    case THROW_IN -> dMode = Mode.ALTA;
                    default -> dMode = Mode.TV;
                }
                dSide = bx >= 0 ? 1 : -1;
            }
            case PLAYING -> {
                if (tick < dEnd && !changed) return;
                double ax = Math.abs(bx);
                boolean sprint = m.carrier != null && Math.hypot(m.carrier.vx, m.carrier.vz) > 0.22;
                if (tick > dNextTrack && sprint) { cut(m.rnd.nextBoolean() ? Mode.RASTEIRA : Mode.SPIDER, 130); dNextTrack = tick + 1500 + m.rnd.nextInt(800); }
                else if (m.carrier != null && m.U(m.carrier.team, m.carrier.pos().x) > 50 && m.rnd.nextInt(3) == 0) { dSide = bx >= 0 ? 1 : -1; cut(Mode.GOL, 90); }
                else if (ax > 13) { dSide = bx >= 0 ? 1 : -1; cut(Mode.ALTA, 110 + m.rnd.nextInt(60)); }
                else cut(Mode.TV, 110 + m.rnd.nextInt(80));
            }
            case HALFTIME, FULLTIME -> { dMode = Mode.TORCIDA; dTeam = 0; }
            default -> dMode = Mode.TV;
        }
    }

    // ------------------------------------------------------------------ enquadramentos

    private Vec3 lagBall() { return hist.isEmpty() ? m.bp() : hist.peekFirst(); }

    /** Foco de operador: bola com atraso + um pouco do centro dos jogadores próximos. */
    private Vec3 playFocus() {
        Vec3 b = lagBall(), v = m.ball.getDeltaMovement();
        double sx = b.x, sz = b.z; int n = 0; double cx = 0, cz = 0;
        for (FPlayer p : m.all) { Vec3 q = p.pos(); if (Match.hd(q, b) < 16) { cx += q.x; cz += q.z; n++; } }
        if (n > 0) { sx = b.x * 0.7 + (cx / n) * 0.3; sz = b.z * 0.7 + (cz / n) * 0.3; }
        double hv = Math.hypot(v.x, v.z);
        double lead = Math.min(6, hv * 5);
        return new Vec3(sx + (hv > 0.05 ? v.x / hv * lead : 0), m.pitch.surf() + 0.6, sz + (hv > 0.05 ? v.z / hv * lead : 0));
    }

    private Shot shotFor(Mode mode, Sess s, ServerPlayer pl) {
        Pitch p = m.pitch;
        double cx = p.cx(), cz = p.cz(), gy = p.surf(), HL = Pitch.HALF_L, HW = Pitch.HALF_W;
        Vec3 b = m.bp();
        Vec3 pf = playFocus();
        switch (mode) {
            case TV: return new Shot("principal", new Vec3(cx, gy + 13, cz + HW + 8), pf, 1, 0.8, 3.5, 0);
            case ALTA: {
                int side = s.mode == Mode.AUTO || s.forced ? dSide : (b.x >= cx ? 1 : -1);
                return new Shot("alta" + side, new Vec3(cx + side * (HL - 22), gy + 12, cz + HW + 7), pf, 1, 0.9, 3.0, 0);
            }
            case GOL: {
                int end = s.mode == Mode.AUTO || s.forced ? dSide : endOfBall();
                return new Shot("gol" + end, new Vec3(cx + end * (HL + 9), gy + 9, cz), pf, 1, 0.9, 3.0, 0);
            }
            case RASTEIRA: {
                double x = clamp(lagBall().x, cx - HL + 6, cx + HL - 6);
                return new Shot("rasteira", new Vec3(x, gy + 1.7, cz + HW + 2.8), new Vec3(b.x, gy + 0.8, b.z), 0.05, 1.8, 1.0, 0.35);
            }
            case SPIDER: {
                Vec3 f = playFocus();
                return new Shot("spider", new Vec3(f.x - Math.signum(f.x - cx) * 4, gy + 17, cz + (f.z - cz) * 0.35 + 6), f, 0.025, 1.0, 1.5, 0.15);
            }
            case ESCANTEIO: {
                int sx = b.x >= cx ? 1 : -1, sz = b.z >= cz ? 1 : -1;
                Vec3 spot = new Vec3(cx + sx * (HL - 9), gy + 1.0, cz);
                Vec3 f = m.bh() > 1.0 ? b : spot;
                return new Shot("escanteio" + sx + sz, new Vec3(cx + sx * (HL + 3.5), gy + 2.4, cz + sz * (HW + 3.5)), f, 1, 1.0, 2.0, 0.3);
            }
            case ROSTO: {
                FPlayer f = s.mode == Mode.AUTO || s.forced ? dSubject : (m.carrier != null ? m.carrier : m.lastToucher);
                if (f == null || !f.e.isAlive()) f = m.all.get(0);
                Vec3 q = f.pos();
                Vec3 pos = new Vec3(q.x + f.fx * 3.4 - f.fz * 1.5, q.y + 1.9, q.z + f.fz * 3.4 + f.fx * 1.5);
                return new Shot("rosto" + f.team + f.def.num(), pos, new Vec3(q.x, q.y + 1.55, q.z), 0.12, 1.2, 0.5, 0.35);
            }
            case TORCIDA: {
                int team = s.mode == Mode.AUTO || s.forced ? dTeam : 0;
                int end = team == 0 ? -1 : 1;
                double sweep = Math.sin(tick * 0.012) * 14;
                return new Shot("torcida" + end, new Vec3(cx + end * (HL + 2.5), gy + 3.5, cz + sweep * 0.3),
                    new Vec3(cx + end * (Stadium.RX0 + 7), gy + 8, cz + sweep), 1, 0.5, 0, 0.3);
            }
            case TATICA: return new Shot("tatica", new Vec3(cx, gy + 54, cz + 0.01), new Vec3(cx, gy, cz), 1, 90, 0, 0);
            case BOLA: {
                Vec3 v = m.ball.getDeltaMovement(); double hv = Math.hypot(v.x, v.z);
                double dx = hv > 0.1 ? v.x / hv : 1, dz = hv > 0.1 ? v.z / hv : 0;
                return new Shot("bola", new Vec3(b.x - dx * 9, gy + 3.6, b.z - dz * 9), new Vec3(b.x + dx * 6, b.y + 0.5, b.z + dz * 6), 0.05, 2.5, 0, 0);
            }
            case DRONE: {
                double ang = tick * 0.012;
                return new Shot("drone", new Vec3(b.x + Math.cos(ang) * 20, gy + 11, b.z + Math.sin(ang) * 20), b, 0.06, 2.0, 0, 0);
            }
            case ARQ: {
                Vec3 seat = Tickets.seatFor(m, pl);
                return new Shot("arq", seat.add(0, 1.0, 0), pf, 1, 0.9, 3.0, 0);
            }
            default: return new Shot("principal", new Vec3(cx, gy + 13, cz + HW + 8), pf, 1, 0.8, 3.5, 0);
        }
    }

    private void update(ServerPlayer pl, Sess s) {
        Mode mode = s.mode == Mode.AUTO ? dMode : s.mode;
        if (mode == Mode.JOGADOR) {
            FPlayer f = m.carrier != null ? m.carrier : m.lastToucher;
            if (f != null && f != s.followed && f.e.isAlive()) { s.followed = f; pl.setCamera(f.e); s.expect = f.e; s.grace = tick + 4; }
            return;
        }
        if (s.followed != null) { s.followed = null; pl.setCamera(s.cam); s.expect = s.cam; s.grace = tick + 4; }
        Shot sh = shotFor(mode, s, pl);
        double dx = sh.focus().x - sh.pos().x, dy = sh.focus().y - sh.pos().y, dz = sh.focus().z - sh.pos().z;
        double ty = Match.yawTo(dx, dz), tp = Math.toDegrees(Math.atan2(-dy, Math.max(0.01, Math.hypot(dx, dz))));
        if (!sh.key().equals(s.key)) {                       // CORTE: troca seca de câmera
            s.key = sh.key(); s.pos = sh.pos(); s.yaw = ty; s.pitch = tp;
        } else {
            s.pos = s.pos.add(sh.pos().subtract(s.pos).scale(sh.posAlpha()));
            double dyaw = Match.Mth_wrap(ty - s.yaw), dpit = tp - s.pitch;
            double dead = sh.dead();
            // zona morta: o operador só gira quando a bola chega perto da borda do quadro
            double ay = Math.abs(dyaw) <= dead ? 0 : dyaw - Math.signum(dyaw) * dead * 0.5;
            double ap = Math.abs(dpit) <= dead ? 0 : dpit - Math.signum(dpit) * dead * 0.5;
            s.yaw += clamp(ay * 0.07, -sh.panMax(), sh.panMax());
            s.pitch += clamp(ap * 0.07, -sh.panMax() * 0.7, sh.panMax() * 0.7);
        }
        double sw = sh.shake();
        float yaw = (float) (s.yaw + (sw > 0 ? Math.sin(tick * 0.31) * sw : 0)), pitch = (float) (s.pitch + (sw > 0 ? Math.sin(tick * 0.23 + 1.7) * sw * 0.7 : 0));
        s.cam.snapTo(s.pos.x, s.pos.y - s.cam.getEyeHeight(), s.pos.z, yaw, pitch);
    }

    /** Teste de desenvolvimento: calcula todos os enquadramentos e acusa valores inválidos. */
    String selfTest() {
        Sess s = new Sess(); s.mode = Mode.AUTO; StringBuilder bad = new StringBuilder();
        for (Mode md : Mode.values()) {
            if (md == Mode.ARQ || md == Mode.JOGADOR) continue;
            Shot sh = shotFor(md, s, null);
            for (double d : new double[]{sh.pos().x, sh.pos().y, sh.pos().z, sh.focus().x, sh.focus().y, sh.focus().z})
                if (Double.isNaN(d) || Double.isInfinite(d)) bad.append(md.id).append(' ');
        }
        return bad + "|" + dMode.id;
    }

    private static double clamp(double v, double lo, double hi) { return Math.max(lo, Math.min(hi, v)); }
}
