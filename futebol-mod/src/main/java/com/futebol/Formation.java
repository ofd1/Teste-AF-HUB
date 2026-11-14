package com.futebol;

import java.util.Map;

/** Formações táticas: (posto, u = metros a partir do gol, v = lateral + direita). */
public final class Formation {
    private Formation() {}

    public record Slot(Pos pos, double u, double v) {}

    private static Slot s(Pos p, double u, double v) { return new Slot(p, u, v); }

    private static final Slot[] BACK4 = {
        s(Pos.GK, 1.5, 0), s(Pos.FB, 14, 14.5), s(Pos.CB, 11, 5.5), s(Pos.CB, 11, -5.5), s(Pos.FB, 14, -14.5)};

    private static Slot[] join(Slot... rest) {
        Slot[] r = new Slot[BACK4.length + rest.length];
        System.arraycopy(BACK4, 0, r, 0, BACK4.length);
        System.arraycopy(rest, 0, r, BACK4.length, rest.length);
        return r;
    }

    public static final Map<String, Slot[]> ALL = Map.of(
        "433", join(s(Pos.DM, 21, 0), s(Pos.CM, 26, 7), s(Pos.CM, 26, -7), s(Pos.WG, 37, 14), s(Pos.ST, 42, 0), s(Pos.WG, 37, -14)),
        "4231", join(s(Pos.DM, 21, 5), s(Pos.DM, 21, -5), s(Pos.WG, 31, 13.5), s(Pos.SS, 33, 0), s(Pos.WG, 31, -13.5), s(Pos.ST, 42, 0)),
        "442", join(s(Pos.WG, 28, 15), s(Pos.DM, 22, 5), s(Pos.CM, 25, -5), s(Pos.WG, 28, -15), s(Pos.ST, 40, 6), s(Pos.SS, 36, -6))
    );

    public static Slot[] get(String id) { return ALL.getOrDefault(id, ALL.get("442")); }
}
