package com.futebol;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.item.DyeColor;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.StairBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.List;

/** Arquibancadas em anéis, teto, fachada, telões, bancos de reservas — e a lista de assentos. */
public final class Stadium {
    public static final int R = 13;                              // fileiras
    public static final int RX0 = Pitch.HALF_L + 7, RZ0 = Pitch.HALF_W + 5;
    public static final int ROOF = R + 5;                        // altura do teto acima do gramado
    public static final int REACH_X = RX0 + R + 5, REACH_Z = RZ0 + R + 5;

    public static final int END_HOME = 0, END_AWAY = 1, SIDE = 2, VIP = 3, CENTRAL = 4;
    public record Seat(Vec3 pos, float yaw, int kind) {}

    public final List<Seat> seats = new ArrayList<>();
    private final Pitch p;

    private static final int[][] DYE_RGB = {
        {0xF9FFFE, 0}, {0xF9801D, 1}, {0xC74EBD, 2}, {0x3AB3DA, 3}, {0xFED83D, 4}, {0x80C71F, 5}, {0xF38BAA, 6}, {0x474F52, 7},
        {0x9D9D97, 8}, {0x169C9C, 9}, {0x8932B8, 10}, {0x3C44AA, 11}, {0x835432, 12}, {0x5E7C16, 13}, {0xB02E26, 14}, {0x1D1D21, 15}};

    public Stadium(Pitch p) { this.p = p; }

    static DyeColor nearest(int rgb) {
        int best = 0, bd = Integer.MAX_VALUE;
        for (int[] e : DYE_RGB) { int d = Roster.dist(rgb, e[0]); if (d < bd) { bd = d; best = e[1]; } }
        return DyeColor.values()[best];   // ordem de DYE_RGB = ordem do enum
    }

    private BlockState conc(DyeColor c) { return Blocks.CONCRETE.pick(c).defaultBlockState(); }
    private BlockState stair(DyeColor c, Direction f) { return Blocks.CONCRETE_STAIRS.pick(c).defaultBlockState().setValue(StairBlock.FACING, f); }

    public void build(Club home, Club away) {
        seats.clear();
        DyeColor cHome = nearest(Roster.COR_CAMISA[0]), cAway = nearest(Roster.COR_CAMISA[1]);
        DyeColor w = DyeColor.WHITE, gr = DyeColor.GRAY, lg = DyeColor.LIGHT_GRAY, bk = DyeColor.BLACK, gold = DyeColor.YELLOW;

        // ---- arquibancadas ----
        for (int r = 0; r < R; r++) {
            int rx = RX0 + r, rz = RZ0 + r, y = 1 + r;
            for (int dz = -rz; dz <= rz; dz++) for (int dx = -rx; dx <= rx; dx++) {
                if (Math.abs(dx) != rx && Math.abs(dz) != rz) continue;
                boolean xDom = Math.abs(dx) - RX0 > Math.abs(dz) - RZ0;
                Direction f; int kind; DyeColor col;
                if (xDom) {
                    f = dx > 0 ? Direction.WEST : Direction.EAST;
                    kind = dx < 0 ? END_HOME : END_AWAY;
                    col = dx < 0 ? cHome : cAway;
                    if ((Math.abs(dz) + r) % 7 == 0) col = w;                       // listras de torcida
                } else {
                    f = dz > 0 ? Direction.NORTH : Direction.SOUTH;
                    if (dx < -15) { kind = END_HOME; col = cHome; }
                    else if (dx > 15) { kind = END_AWAY; col = cAway; }
                    else { kind = SIDE; col = ((dx + r) & 3) < 2 ? w : lg; }
                    if (dz < 0 && r >= 9 && Math.abs(dx) <= 14) { kind = VIP; col = gold; }              // camarote
                    else if (kind == SIDE && r >= 2 && r <= 8) kind = CENTRAL;
                    if (Math.abs(dx) % 14 == 0 && kind != VIP) col = gr;                                // corredores
                }
                p.put(dx, y, dz, stair(col, f));
                if (col != gr && ((dx * 31 + dz * 17 + r) % 3 != 0 || kind == VIP)) {
                    double sx = p.cx() - 0.5 + dx + 0.5, sz = p.cz() - 0.5 + dz + 0.5;
                    float yaw = switch (f) { case NORTH -> 180f; case SOUTH -> 0f; case WEST -> 90f; default -> -90f; };
                    seats.add(new Seat(new Vec3(sx, p.gy + y + 1.0, sz), yaw, kind));
                }
            }
        }

        // ---- fachada externa + pilares ----
        int ox = RX0 + R, oz = RZ0 + R;
        for (int y = 0; y <= ROOF; y++)
            for (int dz = -oz; dz <= oz; dz++) for (int dx = -ox; dx <= ox; dx++) {
                if (Math.abs(dx) != ox && Math.abs(dz) != oz) continue;
                BlockState s;
                boolean pillar = (Math.abs(dx) % 10 == 0 && Math.abs(dz) == oz) || (Math.abs(dz) % 10 == 0 && Math.abs(dx) == ox) || (Math.abs(dx) == ox && Math.abs(dz) == oz);
                if (pillar) s = conc(w);
                else if (y == ROOF - 2) s = Blocks.SEA_LANTERN.defaultBlockState();                // faixa de LED
                else if (y >= R + 1 && y <= ROOF - 3) s = Blocks.STAINED_GLASS_PANE.pick(DyeColor.BLACK).defaultBlockState();   // vidro escuro
                else s = conc(y % 5 == 4 ? gr : bk);
                p.put(dx, y, dz, s);
            }

        // ---- teto (anel de lajes de quartzo) + LED na borda interna ----
        for (int r = 4; r <= R + 4; r++) {
            int rx = RX0 + r, rz = RZ0 + r;
            for (int dz = -rz; dz <= rz; dz++) for (int dx = -rx; dx <= rx; dx++) {
                if (Math.abs(dx) != rx && Math.abs(dz) != rz) continue;
                BlockState s = r == 4 ? Blocks.SEA_LANTERN.defaultBlockState() : Blocks.QUARTZ_SLAB.defaultBlockState();
                p.put(dx, ROOF, dz, s);
                if (r == 4) p.put(dx, ROOF + 1, dz, Blocks.QUARTZ_SLAB.defaultBlockState());
                if (r > 4 && r < R && (dx + dz) % 6 == 0 && ((r & 1) == 0)) p.put(dx, ROOF - 1, dz, Blocks.LIGHT.defaultBlockState());   // luz sob o teto
            }
        }

        // ---- telões gigantes nos dois fundos e painel lateral ----
        for (int s = -1; s <= 1; s += 2) {
            int px = s * (RX0 + 4);
            for (int dz = -13; dz <= 13; dz++) for (int y = ROOF - 9; y <= ROOF - 2; y++) {
                boolean frame = Math.abs(dz) == 13 || y == ROOF - 9 || y == ROOF - 2;
                p.put(px + s, y, dz, frame ? conc(gr) : conc(bk));
            }
        }
        int pz = -(RZ0 + 4);
        for (int dx = -9; dx <= 9; dx++) for (int y = ROOF - 8; y <= ROOF - 2; y++)
            p.put(dx, y, pz - 1, (Math.abs(dx) == 9 || y == ROOF - 8 || y == ROOF - 2) ? conc(gr) : conc(bk));

        // ---- bancos de reservas (cobertos, com vidro) nos dois lados da linha lateral ----
        for (int bx = -22; bx <= 22; bx += 44) for (int i = 0; i < 9; i++) {
            int dx = bx + (bx < 0 ? i : -i);
            int dz = Pitch.HALF_W + 3;
            p.put(dx, 1, dz, stair(DyeColor.BLACK, Direction.NORTH));
            p.put(dx, 3, dz, Blocks.QUARTZ_SLAB.defaultBlockState());
            p.put(dx, 3, dz - 1, Blocks.QUARTZ_SLAB.defaultBlockState());
            if (i == 0 || i == 8) { p.put(dx, 1, dz - 1, conc(gr)); p.put(dx, 2, dz - 1, conc(gr)); }
        }
    }

    public List<Seat> ofKind(int kind) {
        List<Seat> l = new ArrayList<>();
        for (Seat s : seats) if (s.kind() == kind) l.add(s);
        return l;
    }

    /** Centro de uma torcida (para tocar sons). */
    public Vec3 endCenter(int team) {
        double x = p.cx() + (team == 0 ? -1 : 1) * (RX0 + 6);
        return new Vec3(x, p.surf() + 7, p.cz());
    }
}
