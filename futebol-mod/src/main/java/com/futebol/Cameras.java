package com.futebol;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.decoration.ArmorStand;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Câmeras de TV: o jogador "assiste" por uma entidade invisível (ou pelos olhos de um jogador). Agachar sai da câmera. */
public final class Cameras {
    public enum Mode {
        TV("tv", "Transmissão (lateral)"), TATICA("tatica", "Tática (de cima)"), GOL("gol", "Atrás do gol"),
        BOLA("bola", "Câmera da bola"), JOGADOR("jogador", "Visão do jogador"), DRONE("drone", "Drone orbital"),
        ARQ("arquibancada", "Arquibancada"), AUTO("auto", "Diretor automático");
        public final String id, nome;
        Mode(String id, String nome) { this.id = id; this.nome = nome; }
        public static Mode of(String s) { for (Mode m : values()) if (m.id.equals(s)) return m; return null; }
    }

    private static final class Sess {
        net.minecraft.world.entity.Entity expect; int grace; ArmorStand cam; Mode mode, shown; Vec3 pos, focus; int born, lastPick; boolean forced; Mode prev; FPlayer followed;
    }

    private final Match m;
    private final Map<UUID, Sess> sess = new HashMap<>();
    private int tick;

    public Cameras(Match m) { this.m = m; }

    public boolean active(ServerPlayer pl) { return sess.containsKey(pl.getUUID()); }

    public Mode modeOf(ServerPlayer pl) { Sess s = sess.get(pl.getUUID()); return s == null ? null : s.mode; }

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
            s.pos = p.add(0, 1.6, 0); s.focus = m.bp();
            sess.put(pl.getUUID(), s);
        }
        s.mode = mode; s.shown = null; s.born = tick; s.forced = false;
        pl.setCamera(s.cam); s.expect = s.cam; s.grace = tick + 4; s.followed = null;
        pl.sendSystemMessage(net.minecraft.network.chat.Component.literal("§b🎥 Câmera: " + mode.nome + " §7(agache para sair)"), true);
    }

    /** Câmera temporária de transmissão para todos (replays). */
    public void forceAll(Mode mode) {
        for (ServerPlayer pl : m.level.players()) {
            Sess s = sess.get(pl.getUUID());
            if (s == null) { set(pl, mode); s = sess.get(pl.getUUID()); s.forced = true; s.prev = null; }
            else if (!s.forced) { s.prev = s.mode; s.mode = mode; s.shown = null; s.forced = true; pl.setCamera(s.cam); s.expect = s.cam; s.grace = tick + 4; s.followed = null; }
        }
    }

    public void releaseForced() {
        for (ServerPlayer pl : new ArrayList<>(m.level.players())) {
            Sess s = sess.get(pl.getUUID());
            if (s == null || !s.forced) continue;
            if (s.prev != null) { s.mode = s.prev; s.prev = null; s.forced = false; s.shown = null; }
            else stop(pl);
        }
    }

    public void stop(ServerPlayer pl) {
        Sess s = sess.remove(pl.getUUID());
        if (s == null) return;
        if (pl.getCamera() != pl) pl.setCamera(pl);
        s.cam.discard();
        pl.sendSystemMessage(net.minecraft.network.chat.Component.literal("§7Câmera normal."), true);
    }

    public void stopAll() {
        for (ServerPlayer pl : new ArrayList<>(m.level.players())) stop(pl);
        for (Sess s : sess.values()) s.cam.discard();
        sess.clear();
    }

    public void tick() {
        tick++;
        List<UUID> gone = new ArrayList<>();
        for (Map.Entry<UUID, Sess> en : sess.entrySet()) {
            ServerPlayer pl = m.level.getServer().getPlayerList().getPlayer(en.getKey());
            Sess s = en.getValue();
            if (pl == null || !pl.isAlive()) { s.cam.discard(); gone.add(en.getKey()); continue; }
            if (tick > s.grace && pl.getCamera() != s.expect) { s.cam.discard(); gone.add(en.getKey()); continue; }  // agachou: saiu
            update(pl, s);
        }
        gone.forEach(sess::remove);
    }

    private Mode auto(Sess s) {
        if (tick - s.lastPick < 70 && s.shown != null) return s.shown;
        s.lastPick = tick;
        Match.St st = m.st;
        if (st == Match.St.REPLAY) {
            Mode[] seq = {Mode.TV, Mode.GOL, Mode.BOLA, Mode.DRONE};
            return seq[(m.replayIdx * 4 / Math.max(1, m.replayLen)) % 4];
        }
        if (st == Match.St.GOAL) return Mode.DRONE;
        if (st == Match.St.SETPIECE && (m.sp == Match.SP.CORNER || m.sp == Match.SP.PENALTY || m.sp == Match.SP.FREE_KICK)) return Mode.GOL;
        Vec3 b = m.bp();
        double dx = Math.abs(b.x - m.pitch.cx());
        if (dx > Pitch.HALF_L - 14 && m.carrier != null) return Mode.GOL;
        return tick % 400 < 300 ? Mode.TV : Mode.BOLA;
    }

    private void update(ServerPlayer pl, Sess s) {
        Pitch p = m.pitch;
        Vec3 b = m.bp(), bv = m.ball.getDeltaMovement();
        Mode mode = s.mode == Mode.AUTO ? auto(s) : s.mode;
        if (mode != s.shown && s.mode == Mode.AUTO) s.shown = mode;
        double cx = p.cx(), cz = p.cz(), gy = p.surf();
        Vec3 pos, focus = new Vec3(b.x + bv.x * 6, b.y + 0.5, b.z + bv.z * 6);
        double alpha = 0.08;
        switch (mode) {
            case TV -> pos = new Vec3(clamp(b.x, cx - 26, cx + 26), gy + 12, cz + 31);
            case TATICA -> { pos = new Vec3(cx, gy + 42, cz + 0.01); focus = new Vec3(cx, gy, cz); alpha = 0.2; }
            case GOL -> {
                double side = Math.signum(b.x - cx) == 0 ? 1 : Math.signum(b.x - cx);
                pos = new Vec3(cx + side * (Pitch.HALF_L + 4.6), gy + 4.3, cz + (b.z - cz) * 0.3);
            }
            case BOLA -> {
                double hv = Math.hypot(bv.x, bv.z);
                double dx = hv > 0.1 ? bv.x / hv : 1, dz = hv > 0.1 ? bv.z / hv : 0;
                pos = new Vec3(b.x - dx * 7, gy + 3.2, b.z - dz * 7); alpha = 0.05;
            }
            case DRONE -> {
                double ang = tick * 0.012;
                pos = new Vec3(b.x + Math.cos(ang) * 15, gy + 9, b.z + Math.sin(ang) * 15); alpha = 0.06;
            }
            case ARQ -> {
                Vec3 seat = Tickets.seatFor(m, pl);
                pos = seat.add(0, 1.0, 0); alpha = 0.5;
            }
            case JOGADOR -> {
                FPlayer f = m.carrier != null ? m.carrier : m.lastToucher;
                if (f != null && f != s.followed && f.e.isAlive()) { s.followed = f; pl.setCamera(f.e); s.expect = f.e; s.grace = tick + 4; }
                return;
            }
            default -> pos = new Vec3(cx, gy + 14, cz + 31);
        }
        if (s.followed != null) { s.followed = null; pl.setCamera(s.cam); s.expect = s.cam; s.grace = tick + 4; }
        s.pos = s.pos.add(pos.subtract(s.pos).scale(alpha));
        s.focus = s.focus.add(focus.subtract(s.focus).scale(mode == Mode.TATICA ? 1 : 0.15));
        double dx = s.focus.x - s.pos.x, dy = s.focus.y - s.pos.y, dz = s.focus.z - s.pos.z, h = Math.hypot(dx, dz);
        float yaw = mode == Mode.TATICA ? -90f : Match.yawTo(dx, dz);
        float pitch = mode == Mode.TATICA ? 90f : (float) Math.toDegrees(Math.atan2(-dy, Math.max(0.01, h)));
        s.cam.snapTo(s.pos.x, s.pos.y - s.cam.getEyeHeight(), s.pos.z, yaw, pitch);
    }

    private static double clamp(double v, double lo, double hi) { return Math.max(lo, Math.min(hi, v)); }
}
