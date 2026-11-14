package com.futebol;

import java.util.List;

/** Um clube: identidade visual + 11 titulares já posicionados na formação. */
public record Club(String id, String nome, String sigla, int chest, int shorts, int alt, String formation, String pais, List<Roster.Def> defs) {}
