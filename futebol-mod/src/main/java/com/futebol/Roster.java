package com.futebol;

import java.util.List;

/** Elencos: 11 jogadores por time, cada um com suas estatísticas (formação 4-4-2). */
public final class Roster {
    private Roster() {}

    /** u = metros a partir do próprio gol (0..64), v = lateral (+ direita do time). */
    public record Def(int num, String nome, Pos pos, double u, double v, Stats st) {}

    public static final String[] TIME_NOME = {"Saqueadores", "Vindicadores"};
    public static final int[] COR_CAMISA = {0xC62828, 0x1565C0};
    public static final int[] COR_CALCAO = {0xFFFFFF, 0xFFFFFF};
    public static final int[] COR_GOLEIRO = {0x2E7D32, 0xF9A825};
    /** Códigos de cor de chat. */
    public static final String[] COR_CHAT = {"§c", "§9"};

    //                                       vel fin pas dri des for vis fol ref agr
    public static final List<Def> SAQUEADORES = List.of(
        new Def(1,  "Muralha",     Pos.GK, 1.5,   0,    new Stats(45, 20, 55, 30, 40, 70, 78, 70, 88, 30)),
        new Def(2,  "Tufão",       Pos.FB, 14,   14.5,  new Stats(82, 40, 66, 68, 70, 62, 60, 88, 12, 55)),
        new Def(4,  "Rochedo",     Pos.CB, 11,    5.5,  new Stats(55, 25, 52, 40, 88, 90, 70, 72, 10, 85)),
        new Def(5,  "Paredão",     Pos.CB, 11,   -5.5,  new Stats(58, 22, 58, 42, 84, 86, 76, 70, 10, 70)),
        new Def(3,  "Zeca",        Pos.FB, 14,  -14.5,  new Stats(78, 35, 70, 64, 66, 60, 62, 85, 12, 50)),
        new Def(7,  "Raio",        Pos.WG, 27,   15,    new Stats(94, 70, 66, 84, 30, 52, 66, 78, 5, 30)),
        new Def(6,  "Maestro",     Pos.DM, 22,    5,    new Stats(62, 55, 85, 72, 72, 70, 90, 84, 8, 55)),
        new Def(8,  "Cérebro",     Pos.CM, 25,   -5,    new Stats(66, 62, 88, 80, 58, 58, 92, 80, 8, 35)),
        new Def(11, "Foguete",     Pos.WG, 27,  -15,    new Stats(90, 72, 64, 86, 28, 48, 62, 76, 5, 25)),
        new Def(9,  "Artilheiro",  Pos.ST, 40,    6,    new Stats(80, 93, 55, 78, 25, 80, 70, 74, 5, 50)),
        new Def(10, "Camisa Dez",  Pos.SS, 36,   -6,    new Stats(76, 84, 82, 90, 30, 55, 88, 72, 5, 30))
    );

    public static final List<Def> VINDICADORES = List.of(
        new Def(1,  "Gigante",     Pos.GK, 1.5,   0,    new Stats(40, 18, 45, 28, 42, 82, 70, 68, 82, 40)),
        new Def(2,  "Trator",      Pos.FB, 14,   14.5,  new Stats(76, 38, 58, 60, 74, 76, 58, 84, 12, 70)),
        new Def(4,  "Brutus",      Pos.CB, 11,    5.5,  new Stats(50, 20, 40, 32, 91, 93, 62, 70, 10, 92)),
        new Def(5,  "Capitão",     Pos.CB, 11,   -5.5,  new Stats(56, 24, 68, 46, 86, 82, 85, 74, 10, 60)),
        new Def(3,  "Marreta",     Pos.FB, 14,  -14.5,  new Stats(74, 34, 60, 58, 76, 78, 56, 82, 12, 75)),
        new Def(7,  "Cometa",      Pos.WG, 27,   15,    new Stats(92, 68, 70, 88, 32, 50, 68, 80, 5, 28)),
        new Def(6,  "Cão de Guarda", Pos.DM, 22,  5,    new Stats(64, 48, 70, 58, 85, 80, 74, 86, 8, 80)),
        new Def(8,  "Armador",     Pos.CM, 25,   -5,    new Stats(68, 60, 90, 78, 55, 56, 90, 78, 8, 30)),
        new Def(11, "Relâmpago",   Pos.WG, 27,  -15,    new Stats(96, 60, 58, 80, 26, 46, 58, 74, 5, 22)),
        new Def(9,  "Matador",     Pos.ST, 40,    6,    new Stats(72, 90, 50, 70, 28, 88, 66, 72, 5, 58)),
        new Def(10, "Mágico",      Pos.SS, 36,   -6,    new Stats(78, 80, 85, 92, 28, 52, 90, 70, 5, 26))
    );

    public static List<Def> time(int t) { return t == 0 ? SAQUEADORES : VINDICADORES; }
}
