package com.futebol;

/** Posições em campo. */
public enum Pos {
    GK("Goleiro", "GOL", 0), CB("Zagueiro", "ZAG", 1), FB("Lateral", "LAT", 1),
    DM("Volante", "VOL", 2), CM("Meia", "MEI", 2), WG("Ponta", "PON", 3),
    ST("Centroavante", "ATA", 3), SS("Segundo atacante", "SA", 3);

    public final String nome, sigla;
    /** 0 = goleiro, 1 = defesa, 2 = meio, 3 = ataque */
    public final int linha;

    Pos(String nome, String sigla, int linha) { this.nome = nome; this.sigla = sigla; this.linha = linha; }
}
