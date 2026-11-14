package com.futebol;

import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.commands.CommandSourceStack;

/** Ferramenta de desenvolvimento: FUTEBOL_AUTOTEST=<ticks> sobe, joga e desliga o servidor registrando estatísticas. */
final class AutoTest {
    private AutoTest() {}
    static int ticks, maxTicks;
    static final double[][] posSum = new double[2][11]; static final double[][] posN = new double[2][11];
    static final double[][] mn = new double[2][11], mx = new double[2][11], vabs = new double[2][11];
    static { for (double[] r : mn) java.util.Arrays.fill(r, 99); }
    static int possA, possB, shots; static final int[] hist = new int[4];

    static void init() {
        String v = System.getenv("FUTEBOL_AUTOTEST");
        if (v == null) return;
        maxTicks = Integer.parseInt(v);
        ServerLifecycleEvents.SERVER_STARTED.register(srv -> {
            CommandSourceStack src = srv.createCommandSourceStack();
            srv.getCommands().performPrefixedCommand(src, "futebol ativar" + (System.getenv("FUTEBOL_CLUBS") != null ? " " + System.getenv("FUTEBOL_CLUBS") : ""));
            srv.getCommands().performPrefixedCommand(src, "futebol tempo " + (System.getenv("FUTEBOL_HALF") != null ? System.getenv("FUTEBOL_HALF") : "" + (maxTicks / 40)));
            dump(FutebolMod.match);
            FutebolMod.match.start();
            if (System.getenv("FUTEBOL_FAST") != null) srv.getCommands().performPrefixedCommand(src, "tick rate 2000");
        });
        ServerTickEvents.END_SERVER_TICK.register(srv -> {
            Match m = FutebolMod.match;
            if (m == null) return;
            ticks++;
            if (m.carrier != null) { if (m.carrier.team == 0) possA++; else possB++; hist[(int) Math.min(3, Math.max(0, m.U(m.carrier.team, m.carrier.pos().x) / 16))]++; }
            if (m.st == Match.St.PLAYING) for (int t = 0; t < 2; t++) for (int i = 0; i < 11; i++) {
                FPlayer p = m.teams[t][i]; double u = m.U(t, p.pos().x);
                posSum[t][i] += u; posN[t][i]++; mn[t][i] = Math.min(mn[t][i], u); mx[t][i] = Math.max(mx[t][i], u);
                vabs[t][i] += Math.abs(m.V(t, p.pos().z));
            }
            if (ticks % 1500 == 0) {
                StringBuilder sb = new StringBuilder();
                sb.append(String.format("AT t=%d st=%s clock=%d score=%d-%d half=%d ball=(%.1f,%.1f,%.1f) carrier=%s poss=%d/%d",
                    ticks, m.st, m.clock, m.score[0], m.score[1], m.half, m.ball.getX() - m.pitch.cx(), m.ball.getY() - m.pitch.surf(), m.ball.getZ() - m.pitch.cz(),
                    m.carrier == null ? "-" : m.carrier.team + "#" + m.carrier.def.num(), possA, possB));
                FutebolMod.LOG.info(sb.toString());
                for (int t = 0; t < 2; t++) {
                    StringBuilder l = new StringBuilder(" T" + t + " u/v:");
                    for (FPlayer p : m.teams[t]) l.append(String.format(" #%d(%.0f,%.0f)", p.def.num(), m.U(t, p.pos().x), m.V(t, p.pos().z)));
                    FutebolMod.LOG.info(l.toString());
                }
            }
            if (System.getenv("FUTEBOL_TOURNEY") != null) {
                CommandSourceStack src = srv.createCommandSourceStack();
                if (ticks == 5) srv.getCommands().performPrefixedCommand(src, "futebol campeonato novo " + System.getenv("FUTEBOL_TOURNEY"));
                if (ticks == 6) { srv.getCommands().performPrefixedCommand(src, "futebol campeonato jogar"); m = FutebolMod.match; m.halfLen = 600; m.start(); }
                if (m.st == Match.St.FULLTIME && ticks > 100 && Tournament.atual != null) {
                    if (Tournament.atual.isFinished()) { FutebolMod.LOG.info("AUTOTEST CAMPEONATO FIM"); srv.halt(false); }
                    else { srv.getCommands().performPrefixedCommand(src, "futebol campeonato jogar"); m.halfLen = 600; m.start(); }
                }
                if (m.st == Match.St.PLAYING && ticks % 900 == 450 && m.rec.size() > 60 && !m.replaysAuto) m.startReplay(false, 6, 0.5);
                return;
            }
            if (ticks >= maxTicks) {
                FutebolMod.LOG.info("EVENTOS " + m.ev + " histU=" + java.util.Arrays.toString(hist));
                for (int t = 0; t < 2; t++) for (int i = 0; i < 11; i++) {
                    FPlayer p = m.teams[t][i];
                    FutebolMod.LOG.info(String.format("POS T%d #%-2d %-12s %-4s u: avg %4.1f min %4.1f max %4.1f  |v| avg %4.1f", t, p.def.num(), p.def.nome(), p.def.pos().sigla, posSum[t][i] / Math.max(1, posN[t][i]), mn[t][i], mx[t][i], vabs[t][i] / Math.max(1, posN[t][i])));
                }
                FutebolMod.LOG.info("BOLA bb=" + m.ball.getBbWidth() + "x" + m.ball.getBbHeight() + " pillager=" + m.teams[0][1].e.getBbHeight());
                FutebolMod.LOG.info("AUTOTEST FIM score=" + m.score[0] + "-" + m.score[1] + " st=" + m.st + " posse=" + possA + "/" + possB);
                srv.halt(false);
            }
        });
    }

    static void slice(Match m) {
        Pitch p = m.pitch;
        net.minecraft.core.BlockPos.MutableBlockPos bp = new net.minecraft.core.BlockPos.MutableBlockPos();
        for (int y = Stadium.ROOF + 3; y >= 0; y--) {
            StringBuilder sb = new StringBuilder();
            for (int dz = -Stadium.REACH_Z; dz <= Stadium.REACH_Z; dz++) {
                var b = m.level.getBlockState(bp.set(p.bx + 0, p.gy + y, p.bz + dz)).getBlock();
                String n = net.minecraft.core.registries.BuiltInRegistries.BLOCK.getKey(b).getPath();
                char c = b == net.minecraft.world.level.block.Blocks.AIR ? '.' : n.contains("stairs") ? 's' : n.contains("glass") ? 'g' : n.contains("lantern") ? 'L' : n.contains("slab") ? '=' : '#';
                sb.append(c);
            }
            FutebolMod.LOG.info("SLICE " + sb);
        }
    }

    static void dump(Match m) {
        slice(m);
        Pitch p = m.pitch;
        net.minecraft.core.BlockPos.MutableBlockPos bp = new net.minecraft.core.BlockPos.MutableBlockPos();
        for (int dz = -Pitch.HALF_W - 5; dz <= Pitch.HALF_W + 5; dz++) {
            StringBuilder sb = new StringBuilder();
            for (int dx = -Pitch.HALF_L - 8; dx <= Pitch.HALF_L + 8; dx++) {
                var top = m.level.getBlockState(bp.set(p.bx + dx, p.gy + 1, p.bz + dz));
                var gnd = m.level.getBlockState(bp.set(p.bx + dx, p.gy, p.bz + dz));
                char c;
                if (!top.isAir()) c = top.getBlock() == net.minecraft.world.level.block.Blocks.COBWEB ? 'n' : '#';
                else if (gnd.getBlock() == net.minecraft.world.level.block.Blocks.GRASS_BLOCK) c = '.';
                else if (gnd.getBlock() == net.minecraft.world.level.block.Blocks.MOSS_BLOCK) c = ',';
                else c = 'W';
                sb.append(c);
            }
            FutebolMod.LOG.info("MAP " + sb);
        }
    }
}
