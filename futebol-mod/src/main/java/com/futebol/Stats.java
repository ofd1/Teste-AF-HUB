package com.futebol;

/** Estatísticas de 1 a 99 de cada jogador. Todas são usadas de verdade pela IA/física do jogo. */
public record Stats(int vel, int fin, int pas, int dri, int des, int forca, int vis, int fol, int ref, int agr) {

    public static final String[] NOMES = {"Velocidade", "Finalização", "Passe", "Drible", "Desarme", "Força", "Visão de jogo", "Fôlego", "Reflexo (goleiro)", "Agressividade"};

    public int get(int i) {
        return switch (i) {
            case 0 -> vel; case 1 -> fin; case 2 -> pas; case 3 -> dri; case 4 -> des;
            case 5 -> forca; case 6 -> vis; case 7 -> fol; case 8 -> ref; default -> agr;
        };
    }

    /** Nota geral ponderada pela posição. */
    public int overall(Pos pos) {
        double v = switch (pos) {
            case GK -> ref * 0.55 + vis * 0.15 + pas * 0.10 + forca * 0.10 + fol * 0.10;
            case CB -> des * 0.34 + forca * 0.24 + vis * 0.14 + vel * 0.10 + pas * 0.08 + fol * 0.10;
            case FB -> vel * 0.20 + fol * 0.20 + des * 0.20 + pas * 0.14 + dri * 0.12 + vis * 0.08 + forca * 0.06;
            case DM -> des * 0.24 + pas * 0.22 + vis * 0.20 + forca * 0.12 + fol * 0.12 + dri * 0.10;
            case CM -> pas * 0.26 + vis * 0.24 + dri * 0.16 + fol * 0.12 + des * 0.10 + vel * 0.06 + fin * 0.06;
            case WG -> vel * 0.26 + dri * 0.26 + pas * 0.14 + fin * 0.14 + fol * 0.10 + vis * 0.10;
            case ST -> fin * 0.34 + vel * 0.16 + dri * 0.16 + forca * 0.12 + vis * 0.08 + pas * 0.06 + fol * 0.08;
            case SS -> fin * 0.22 + dri * 0.24 + pas * 0.20 + vis * 0.18 + vel * 0.10 + fol * 0.06;
        };
        return (int) Math.round(v);
    }

    /** Índices (0..9) das estatísticas relevantes para a posição (para destacar melhor/pior). */
    public int melhor(Pos pos) { return extremo(pos, true); }
    public int pior(Pos pos) { return extremo(pos, false); }

    private int extremo(Pos pos, boolean max) {
        int best = -1;
        for (int i = 0; i < 10; i++) {
            if (i == 8 && pos != Pos.GK) continue;
            if (best < 0 || (max ? get(i) > get(best) : get(i) < get(best))) best = i;
        }
        return best;
    }
}
