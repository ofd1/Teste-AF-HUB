package com.futebol;

import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.DyeColor;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

/** Geometria do campo + construção (e restauração) dos blocos. O comprimento corre ao longo do eixo X. */
public final class Pitch {
    public static final int HALF_L = 32;          // campo de 64 de comprimento
    public static final int HALF_W = 20;          // e 40 de largura
    public static final double GOAL_HALF = 3.5;   // gol com 7 de largura
    public static final double GOAL_H = 3.0;      // e 3 de altura
    public static final int BOX_D = 12, BOX_HALF = 12;      // grande área
    public static final int SMALL_D = 5, SMALL_HALF = 6;    // pequena área
    public static final int PEN_SPOT = 8;
    private static final int MX = Stadium.REACH_X + 1, MZ = Stadium.REACH_Z + 1, DY_DOWN = 3, DY_UP = Stadium.ROOF + 4;

    public final ServerLevel level;
    public final int bx, bz, gy;
    private BlockState[] saved;

    public Pitch(ServerLevel level, int bx, int gy, int bz) {
        this.level = level; this.bx = bx; this.gy = gy; this.bz = bz;
    }

    public double cx() { return bx + 0.5; }
    public double cz() { return bz + 0.5; }
    /** Altura dos pés de quem está em pé no gramado. */
    public double surf() { return gy + 1.0; }
    public double limX() { return HALF_L + 0.5; }
    public double limZ() { return HALF_W + 0.5; }

    private int idx(int dx, int dy, int dz) {
        int w = 2 * MX + 1, d = 2 * MZ + 1;
        return ((dy + DY_DOWN) * d + (dz + MZ)) * w + (dx + MX);
    }

    private void snapshot() {
        int w = 2 * MX + 1, d = 2 * MZ + 1, h = DY_DOWN + DY_UP + 1;
        saved = new BlockState[w * d * h];
        BlockPos.MutableBlockPos p = new BlockPos.MutableBlockPos();
        for (int dy = -DY_DOWN; dy <= DY_UP; dy++)
            for (int dz = -MZ; dz <= MZ; dz++)
                for (int dx = -MX; dx <= MX; dx++)
                    saved[idx(dx, dy, dz)] = level.getBlockState(p.set(bx + dx, gy + dy, bz + dz));
    }

    public void restore() {
        if (saved == null) return;
        BlockPos.MutableBlockPos p = new BlockPos.MutableBlockPos();
        for (int dy = -DY_DOWN; dy <= DY_UP; dy++)
            for (int dz = -MZ; dz <= MZ; dz++)
                for (int dx = -MX; dx <= MX; dx++)
                    { p.set(bx + dx, gy + dy, bz + dz); if (level.getBlockState(p) != saved[idx(dx, dy, dz)]) level.setBlock(p, saved[idx(dx, dy, dz)], 2); }
        saved = null;
    }

    private final BlockPos.MutableBlockPos mp = new BlockPos.MutableBlockPos();

    private BlockState set(int dx, int dy, int dz, BlockState s) {
        mp.set(bx + dx, gy + dy, bz + dz);
        if (level.getBlockState(mp) != s) level.setBlock(mp, s, 2);
        return s;
    }

    /** Usado pelo Stadium. */
    void put(int dx, int dy, int dz, BlockState s) { set(dx, dy, dz, s); }

    public Stadium stadium;

    /** Recolore as arquibancadas e placas para os clubes atuais. */
    public void recolor() { stadium.build(Roster.ATUAL[0], Roster.ATUAL[1]); recolorBoards(); }

    private void recolorBoards() {
        DyeColor[] cores = {Stadium.nearest(Roster.COR_CAMISA[0]), DyeColor.WHITE, Stadium.nearest(Roster.COR_CAMISA[1]), DyeColor.WHITE};
        int bxm = HALF_L + 6, bzm = HALF_W + 4;
        for (int dx = -bxm; dx <= bxm; dx++) for (int s = -1; s <= 1; s += 2) set(dx, 1, s * bzm, conc(cores[Math.floorMod(dx / 3, 4)]));
        for (int dz = -bzm; dz <= bzm; dz++) for (int s = -1; s <= 1; s += 2) set(s * bxm, 1, dz, conc(cores[Math.floorMod(dz / 3, 4)]));
    }

    private static BlockState conc(DyeColor c) { return Blocks.CONCRETE.pick(c).defaultBlockState(); }

    public void build() {
        snapshot();
        BlockState white = conc(DyeColor.WHITE);
        BlockState dirt = Blocks.DIRT.defaultBlockState();
        BlockState air = Blocks.AIR.defaultBlockState();

        // 1) limpa o volume, preenche o subsolo e faz o gramado listrado
        for (int dz = -MZ; dz <= MZ; dz++)
            for (int dx = -MX; dx <= MX; dx++) {
                for (int dy = -DY_DOWN; dy < 0; dy++) set(dx, dy, dz, dirt);
                boolean stripe = Math.floorMod(Math.floorDiv(dx + HALF_L, 4), 2) == 0;
                set(dx, 0, dz, stripe ? Blocks.GRASS_BLOCK.defaultBlockState() : Blocks.MOSS_BLOCK.defaultBlockState());
                for (int dy = 1; dy <= DY_UP; dy++) set(dx, dy, dz, air);
            }

        // 2) linhas brancas
        for (int dz = -HALF_W; dz <= HALF_W; dz++)
            for (int dx = -HALF_L; dx <= HALF_L; dx++) {
                if (linha(dx, dz)) set(dx, 0, dz, white);
            }

        // 3) gols
        gol(+1); gol(-1);

        // 4) placas de publicidade em volta
        DyeColor[] cores = {Stadium.nearest(Roster.COR_CAMISA[0]), DyeColor.WHITE, Stadium.nearest(Roster.COR_CAMISA[1]), DyeColor.WHITE};
        int bxm = HALF_L + 6, bzm = HALF_W + 4;
        for (int dx = -bxm; dx <= bxm; dx++) for (int s = -1; s <= 1; s += 2)
            set(dx, 1, s * bzm, conc(cores[Math.floorMod(dx / 3, 4)]));
        for (int dz = -bzm; dz <= bzm; dz++) for (int s = -1; s <= 1; s += 2)
            set(s * bxm, 1, dz, conc(cores[Math.floorMod(dz / 3, 4)]));

        // 5) refletores invisíveis (blocos de luz) para o jogo ficar iluminado à noite
        BlockState luz = Blocks.LIGHT.defaultBlockState();
        for (int dx = -HALF_L; dx <= HALF_L; dx += 8) for (int dz = -HALF_W; dz <= HALF_W; dz += 8) set(dx, 10, dz, luz);
        stadium = new Stadium(this);
        stadium.build(Roster.ATUAL[0], Roster.ATUAL[1]);
    }

    private static boolean linha(int dx, int dz) {
        int ax = Math.abs(dx), az = Math.abs(dz);
        if (ax == HALF_L || az == HALF_W) return true;                 // contorno
        if (dx == 0) return true;                                      // meio de campo
        double r = Math.sqrt(dx * dx + dz * dz);
        if (Math.abs(r - 5) < 0.55 || r < 0.6) return true;            // círculo central e ponto
        if (ax >= HALF_L - BOX_D && ax <= HALF_L && (az == BOX_HALF)) return true;       // grande área
        if (ax == HALF_L - BOX_D && az <= BOX_HALF) return true;
        if (ax >= HALF_L - SMALL_D && ax <= HALF_L && az == SMALL_HALF) return true;     // pequena área
        if (ax == HALF_L - SMALL_D && az <= SMALL_HALF) return true;
        return ax == HALF_L - PEN_SPOT && dz == 0;                                       // marca do pênalti
    }

    private void gol(int s) {
        BlockState white = conc(DyeColor.WHITE);
        BlockState bars = Blocks.IRON_BARS.defaultBlockState();
        BlockState web = Blocks.COBWEB.defaultBlockState();
        int gh = (int) GOAL_H, gw = (int) Math.ceil(GOAL_HALF);   // 3 e 4
        int front = HALF_L + 1, back = HALF_L + 3;
        for (int x = front; x <= back; x++) {
            for (int dz = -gw; dz <= gw; dz++) {
                boolean poste = Math.abs(dz) == gw;
                for (int dy = 1; dy <= gh + 1; dy++) {
                    BlockState b;
                    if (dy == gh + 1) b = (x == front || poste) ? white : bars;       // travessão / rede do topo
                    else if (poste) b = (x == front || x == back) ? white : bars;      // postes e rede lateral
                    else if (x == front) b = Blocks.AIR.defaultBlockState();           // boca do gol livre
                    else b = web;                                                      // rede (teia)
                    set(s * x, dy, dz, b);
                }
            }
        }
    }

    // ---- coordenadas do jogo ----

    /** Converte (u, v) de um time com direção de ataque dir (+1/-1) em coordenadas de mundo. */
    public Vec3 world(double u, double v, int dir) {
        return new Vec3(cx() + dir * (-HALF_L + u), surf(), cz() + dir * v);
    }

    public double goalX(int dir) { return cx() + dir * HALF_L; }          // gol que o time (atacando em dir) ataca
    public double ownGoalX(int dir) { return cx() - dir * HALF_L; }
}
