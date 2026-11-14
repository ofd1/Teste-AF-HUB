package com.futebol;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.player.AttackEntityCallback;
import net.fabricmc.fabric.api.event.player.UseEntityCallback;
import net.fabricmc.fabric.api.event.player.UseItemCallback;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Difficulty;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.CustomData;
import net.minecraft.world.phys.Vec3;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class FutebolMod implements ModInitializer {
    public static final Logger LOG = LoggerFactory.getLogger("futebol");
    public static Match match;
    private static int errors;

    @Override
    public void onInitialize() {
        Clubs.load();
        AutoTest.init();
        CommandRegistrationCallback.EVENT.register((d, r, env) -> registerCommands(d));

        ServerTickEvents.END_SERVER_TICK.register(server -> {
            if (match == null) return;
            try { match.tick(); }
            catch (Exception ex) {
                if (errors++ < 5) LOG.error("Erro no jogo", ex);
            }
        });
        ServerLifecycleEvents.SERVER_STOPPING.register(server -> { if (match != null) { match.discardEntities(); match = null; } });

        UseItemCallback.EVENT.register((player, level, hand) -> {
            ItemStack s = player.getItemInHand(hand);
            String tk = Tickets.sectorOf(s);
            if (tk != null) {
                if (!level.isClientSide() && match != null && player instanceof ServerPlayer sp) Tickets.use(match, sp, tk);
                return InteractionResult.SUCCESS;
            }
            if (isControle(s)) {
                if (!level.isClientSide() && match != null && player instanceof ServerPlayer sp) {
                    Cameras.Mode cur = match.cameras.modeOf(sp);
                    if (player.isShiftKeyDown()) match.cameras.stop(sp);
                    else { Cameras.Mode[] all = Cameras.Mode.values(); match.cameras.set(sp, all[cur == null ? 0 : (cur.ordinal() + 1) % all.length]); }
                }
                return InteractionResult.SUCCESS;
            }
            if (!isGraveto(s)) return InteractionResult.PASS;
            if (level.isClientSide()) return InteractionResult.SUCCESS;
            if (match == null) { player.sendSystemMessage(Component.literal("§eUse §f/futebol ativar §epara montar o campo e os times.")); return InteractionResult.SUCCESS; }
            if (player.isShiftKeyDown()) { match.stopToKickoff(); return InteractionResult.SUCCESS; }
            match.start();
            return InteractionResult.SUCCESS;
        });

        // clicar com o botão esquerdo na bola = chutar
        AttackEntityCallback.EVENT.register((player, level, hand, entity, hit) -> {
            if (match == null || entity != match.ball) return InteractionResult.PASS;
            if (!level.isClientSide()) match.humanKick(player);
            return InteractionResult.SUCCESS;
        });

        // clicar com o graveto num jogador = ver as estatísticas
        UseEntityCallback.EVENT.register((player, level, hand, entity, hit) -> {
            if (match == null || !isGraveto(player.getItemInHand(hand))) return InteractionResult.PASS;
            for (FPlayer p : match.all) if (p.e == entity) {
                if (!level.isClientSide() && player instanceof ServerPlayer sp) sendCard(sp, p);
                return InteractionResult.SUCCESS;
            }
            return InteractionResult.PASS;
        });
    }

    // ---------------------------------------------------------------------------------

    public static ItemStack graveto() {
        ItemStack s = new ItemStack(Items.STICK);
        s.set(DataComponents.CUSTOM_NAME, Component.literal("§6§lGraveto do Árbitro"));
        s.set(DataComponents.ENCHANTMENT_GLINT_OVERRIDE, true);
        CompoundTag tag = new CompoundTag();
        tag.putBoolean("futebol_graveto", true);
        s.set(DataComponents.CUSTOM_DATA, CustomData.of(tag));
        return s;
    }

    public static ItemStack controle() {
        ItemStack s = new ItemStack(Items.COMPASS);
        s.set(DataComponents.CUSTOM_NAME, Component.literal("§b§l🎥 Controle de Câmeras"));
        s.set(DataComponents.ENCHANTMENT_GLINT_OVERRIDE, true);
        CompoundTag tag = new CompoundTag();
        tag.putBoolean("futebol_controle", true);
        s.set(DataComponents.CUSTOM_DATA, CustomData.of(tag));
        return s;
    }

    public static boolean isControle(ItemStack s) {
        if (!s.is(Items.COMPASS)) return false;
        CustomData cd = s.get(DataComponents.CUSTOM_DATA);
        return cd != null && cd.copyTag().getBooleanOr("futebol_controle", false);
    }

    public static boolean isGraveto(ItemStack s) {
        if (!s.is(Items.STICK)) return false;
        CustomData cd = s.get(DataComponents.CUSTOM_DATA);
        return cd != null && cd.copyTag().getBooleanOr("futebol_graveto", false);
    }

    /** Remove entidades do jogo que tenham sobrado (ex.: depois de uma queda do servidor). */
    static void purge(ServerLevel level) {
        java.util.List<net.minecraft.world.entity.Entity> lixo = new java.util.ArrayList<>();
        for (net.minecraft.world.entity.Entity e : level.getAllEntities()) if (e.entityTags().contains("futebol")) lixo.add(e);
        lixo.forEach(net.minecraft.world.entity.Entity::discard);
    }

    static int ativar(CommandSourceStack src, Club home, Club away) {
        ServerLevel level = src.getLevel();
        if (match != null) { match.remove(); match = null; }
        purge(level);
        if (level.getDifficulty() == Difficulty.PEACEFUL) {
            src.getServer().setDifficulty(Difficulty.EASY, true);
            src.sendSuccess(() -> Component.literal("§7(Dificuldade mudou de Pacífico para Fácil: pillagers e vindicators não existem no Pacífico.)"), false);
        }
        Vec3 pos = src.getPosition();
        int bx = (int) Math.floor(pos.x), bz = (int) Math.floor(pos.z), gy = (int) Math.floor(pos.y) - 1;
        match = Match.create(level, bx, gy, bz, home, away);
        ServerPlayer pl = src.getPlayer();
        if (pl != null) {
            Pitch p = match.pitch;
            pl.teleportTo(level, p.cx(), p.surf(), p.cz() + Pitch.HALF_W + 2.6, java.util.Set.of(), 180f, 25f, false);
            pl.getInventory().add(graveto());
            pl.getInventory().add(controle());
        }
        src.sendSuccess(() -> Component.literal("§a⚽ Estádio pronto. §eBotão direito com o graveto para apitar. §7(/futebol info on = mais detalhes)"), false);
        return 1;
    }

    static void registerCommands(CommandDispatcher<CommandSourceStack> d) {
        var root = Commands.literal("futebol")
            .executes(c -> { c.getSource().sendSuccess(() -> Component.literal("§e/futebol ativar [casa] [fora] §7| trocar | times | elenco <clube> | jogador <clube> <n> | desativar | graveto | iniciar | tempo <s> | recarregar"), false); return 1; })
            .then(Commands.literal("ativar").executes(c -> ativar(c.getSource(), Clubs.get("barcelona") != null ? Clubs.get("barcelona") : Clubs.get("saqueadores"), Clubs.get("realmadrid") != null ? Clubs.get("realmadrid") : Clubs.get("vindicadores")))
                .then(Commands.argument("casa", StringArgumentType.word()).suggests(CLUBES).then(Commands.argument("fora", StringArgumentType.word()).suggests(CLUBES).executes(c -> {
                    Club h = Clubs.get(StringArgumentType.getString(c, "casa")), a = Clubs.get(StringArgumentType.getString(c, "fora"));
                    if (h == null || a == null || h == a) { c.getSource().sendFailure(Component.literal("Clube inválido. Use /futebol times.")); return 0; }
                    return ativar(c.getSource(), h, a);
                }))))
            .then(Commands.literal("trocar").then(Commands.argument("casa", StringArgumentType.word()).suggests(CLUBES).then(Commands.argument("fora", StringArgumentType.word()).suggests(CLUBES).executes(c -> {
                if (match == null) { c.getSource().sendFailure(Component.literal("Use /futebol ativar primeiro.")); return 0; }
                Club h = Clubs.get(StringArgumentType.getString(c, "casa")), a = Clubs.get(StringArgumentType.getString(c, "fora"));
                if (h == null || a == null || h == a) { c.getSource().sendFailure(Component.literal("Clube inválido. Use /futebol times.")); return 0; }
                match.swapClubs(h, a);
                return 1;
            }))))
            .then(Commands.literal("times").executes(c -> {
                for (Club cl : Clubs.ALL.values())
                    c.getSource().sendSuccess(() -> Component.literal("§f" + cl.id() + " §7— " + cl.nome() + " (" + cl.pais() + ", " + cl.formation().charAt(0) + "-" + cl.formation().substring(1).replaceAll("(.)", "$1-").replaceAll("-$", "") + ") §e★" + overallClube(cl)), false);
                return 1;
            }))

            .then(Commands.literal("info").then(Commands.argument("ligado", com.mojang.brigadier.arguments.BoolArgumentType.bool()).executes(c -> {
                if (match == null) return 0;
                match.verbose = com.mojang.brigadier.arguments.BoolArgumentType.getBool(c, "ligado");
                c.getSource().sendSuccess(() -> Component.literal("§7Detalhes na tela: " + (match.verbose ? "ligados" : "desligados")), false); return 1;
            })))
            .then(Commands.literal("ritmo").then(Commands.argument("fator", com.mojang.brigadier.arguments.FloatArgumentType.floatArg(0.4f, 1.6f)).executes(c -> {
                FPlayer.RITMO = com.mojang.brigadier.arguments.FloatArgumentType.getFloat(c, "fator");
                c.getSource().sendSuccess(() -> Component.literal("§7Ritmo do jogo: " + FPlayer.RITMO + "x (1.0 = padrão)"), false); return 1;
            })))
            .then(Commands.literal("narrador")
                .then(Commands.literal("on").executes(c -> { if (match != null) match.nar.on = true; return 1; }))
                .then(Commands.literal("off").executes(c -> { if (match != null) match.nar.on = false; return 1; }))
                .then(Commands.literal("legenda").then(Commands.argument("ligado", com.mojang.brigadier.arguments.BoolArgumentType.bool()).executes(c -> { if (match != null) match.nar.captions = com.mojang.brigadier.arguments.BoolArgumentType.getBool(c, "ligado"); return 1; })))
                .then(Commands.literal("volume").then(Commands.argument("v", com.mojang.brigadier.arguments.FloatArgumentType.floatArg(0f, 2f)).executes(c -> { if (match != null) match.nar.volume = com.mojang.brigadier.arguments.FloatArgumentType.getFloat(c, "v"); return 1; }))))
            .then(Commands.literal("camera").then(Commands.argument("modo", StringArgumentType.word()).suggests((ctx, b) -> net.minecraft.commands.SharedSuggestionProvider.suggest(java.util.stream.Stream.concat(java.util.Arrays.stream(Cameras.Mode.values()).map(m -> m.id), java.util.stream.Stream.of("normal")), b)).executes(c -> {
                if (match == null) { c.getSource().sendFailure(Component.literal("Use /futebol ativar primeiro.")); return 0; }
                ServerPlayer pl = c.getSource().getPlayerOrException();
                String id = StringArgumentType.getString(c, "modo");
                if (id.equals("normal")) { match.cameras.stop(pl); return 1; }
                Cameras.Mode m = Cameras.Mode.of(id);
                if (m == null) { c.getSource().sendFailure(Component.literal("Câmeras: tv, tatica, gol, bola, jogador, drone, arquibancada, auto, normal")); return 0; }
                match.cameras.set(pl, m);
                return 1;
            })))
            .then(Commands.literal("controle").executes(c -> { c.getSource().getPlayerOrException().getInventory().add(controle()); return 1; }))
            .then(Commands.literal("replay").executes(c -> replay(c.getSource(), 8)).then(Commands.argument("segundos", IntegerArgumentType.integer(3, 20)).executes(c -> replay(c.getSource(), IntegerArgumentType.getInteger(c, "segundos")))))
            .then(Commands.literal("telao").then(Commands.argument("escala", com.mojang.brigadier.arguments.FloatArgumentType.floatArg(0.5f, 12f)).executes(c -> {
                if (match == null) return 0;
                match.screens.setScale(com.mojang.brigadier.arguments.FloatArgumentType.getFloat(c, "escala")); return 1;
            })))
            .then(Commands.literal("torcida").then(Commands.argument("quantidade", IntegerArgumentType.integer(0, 400)).executes(c -> {
                if (match == null) return 0;
                int n = IntegerArgumentType.getInteger(c, "quantidade"); match.crowdSize = n; match.crowd.fill(n);
                c.getSource().sendSuccess(() -> Component.literal("§a" + match.crowd.count + " torcedores (Villagers) no estádio."), false);
                return 1;
            })))
            .then(Commands.literal("torcer").then(Commands.argument("clube", StringArgumentType.word()).suggests(CLUBES).executes(c -> {
                Club cl = Clubs.get(StringArgumentType.getString(c, "clube"));
                if (cl == null) { c.getSource().sendFailure(Component.literal("Clube inválido. Use /futebol times.")); return 0; }
                Tickets.torcer(c.getSource().getPlayerOrException(), cl); return 1;
            })))
            .then(Commands.literal("bilheteria").executes(c -> { c.getSource().sendSuccess(Tickets::bilheteria, false); return 1; }))
            .then(Commands.literal("ingresso")
                .then(Commands.literal("setores").executes(c -> {
                    for (Tickets.Sector s : Tickets.SECTORS) c.getSource().sendSuccess(() -> Component.literal("§f" + s.id() + " §7— " + s.nome() + " §e" + s.preco() + " esmeralda(s) §8(" + s.desc() + ")"), false);
                    return 1;
                }))
                .then(Commands.literal("comprar").then(Commands.argument("setor", StringArgumentType.word()).suggests((ctx, b) -> net.minecraft.commands.SharedSuggestionProvider.suggest(java.util.Arrays.stream(Tickets.SECTORS).map(Tickets.Sector::id), b)).executes(c -> {
                    if (match == null) { c.getSource().sendFailure(Component.literal("Use /futebol ativar primeiro.")); return 0; }
                    Tickets.Sector sec = Tickets.sector(StringArgumentType.getString(c, "setor"));
                    if (sec == null) { c.getSource().sendFailure(Component.literal("Setor inválido. Use /futebol ingresso setores")); return 0; }
                    return Tickets.buy(match, c.getSource().getPlayerOrException(), sec) ? 1 : 0;
                }))))
            .then(Commands.literal("campeonato")
                .then(Commands.literal("novo").then(Commands.argument("tipo", StringArgumentType.word()).suggests((ctx, b) -> net.minecraft.commands.SharedSuggestionProvider.suggest(Tournament.PRESETS, b))
                    .then(Commands.argument("meuClube", StringArgumentType.word()).suggests(CLUBES).executes(c -> {
                        Club me = Clubs.get(StringArgumentType.getString(c, "meuClube"));
                        Tournament t = me == null ? null : Tournament.preset(StringArgumentType.getString(c, "tipo"), me);
                        if (t == null || !t.has(me)) { c.getSource().sendFailure(Component.literal("Tipo: premier, brasileirao ou champions — e seu clube precisa estar nele. (/futebol campeonato clubes <tipo>)")); return 0; }
                        Tournament.atual = t;
                        c.getSource().sendSuccess(() -> Component.literal("§6🏆 " + t.nome + " criado! Seu clube: §f" + me.nome() + "\n§aPróximo: §f" + t.next().home().nome() + " x " + t.next().away().nome() + " §7— use §e/futebol campeonato jogar"), true);
                        return 1;
                    }))))
                .then(Commands.literal("tabela").executes(c -> {
                    if (Tournament.atual == null) { c.getSource().sendFailure(Component.literal("Nenhum campeonato. Use /futebol campeonato novo <tipo> <clube>")); return 0; }
                    Tournament t = Tournament.atual;
                    c.getSource().sendSuccess(() -> Component.literal(t.copa ? "§6§l" + t.nome + " §7— " + t.resumo() : t.tabela()), false); return 1;
                }))
                .then(Commands.literal("cancelar").executes(c -> { Tournament.atual = null; return 1; }))
                .then(Commands.literal("jogar").executes(c -> {
                    Tournament t = Tournament.atual;
                    if (t == null || t.isFinished()) { c.getSource().sendFailure(Component.literal("Nenhum campeonato em andamento.")); return 0; }
                    Tournament.Fixture f = t.next();
                    if (match == null) ativar(c.getSource(), f.home(), f.away()); else match.swapClubs(f.home(), f.away());
                    match.onFinish = m -> t.liveFinished(m.level, m.score[0], m.score[1]);
                    match.boardInfo = t.nome + " · " + t.resumo();
                    c.getSource().sendSuccess(() -> Component.literal("§a⚽ " + f.home().nome() + " x " + f.away().nome() + " — clique com o graveto para começar."), false);
                    return 1;
                })))
            .then(Commands.literal("recarregar").executes(c -> { Clubs.load(); c.getSource().sendSuccess(() -> Component.literal("§a" + Clubs.ALL.size() + " clubes carregados."), false); return 1; }))
            .then(Commands.literal("desativar").executes(c -> {
                if (match == null) { c.getSource().sendFailure(Component.literal("Nenhum campo ativo.")); return 0; }
                match.remove(); match = null;
                purge(c.getSource().getLevel());
                c.getSource().sendSuccess(() -> Component.literal("§7Campo removido e terreno restaurado."), true);
                return 1;
            }))
            .then(Commands.literal("graveto").executes(c -> {
                ServerPlayer pl = c.getSource().getPlayerOrException();
                pl.getInventory().add(graveto());
                return 1;
            }))
            .then(Commands.literal("iniciar").executes(c -> {
                if (match == null) { c.getSource().sendFailure(Component.literal("Use /futebol ativar primeiro.")); return 0; }
                match.start(); return 1;
            }))
            .then(Commands.literal("tempo").then(Commands.argument("segundos", IntegerArgumentType.integer(30, 1200)).executes(c -> {
                if (match == null) { c.getSource().sendFailure(Component.literal("Use /futebol ativar primeiro.")); return 0; }
                int s = IntegerArgumentType.getInteger(c, "segundos");
                match.halfLen = s * 20;
                c.getSource().sendSuccess(() -> Component.literal("§aCada tempo agora dura " + s + "s."), true);
                return 1;
            })))
            .then(Commands.literal("elenco").then(Commands.argument("clube", StringArgumentType.word()).suggests(CLUBES).executes(c -> {
                Club cl = Clubs.get(StringArgumentType.getString(c, "clube"));
                if (cl == null) { c.getSource().sendFailure(Component.literal("Clube inválido. Use /futebol times.")); return 0; }
                c.getSource().sendSuccess(() -> Component.literal("§l" + cl.nome() + " §7(" + cl.formation() + ")"), false);
                for (Roster.Def df : cl.defs())
                    c.getSource().sendSuccess(() -> Component.literal(" §f#" + df.num() + " " + df.nome() + " §7" + df.pos().sigla + " §e★" + df.st().overall(df.pos())), false);
                return 1;
            })))
            .then(Commands.literal("jogador").then(Commands.argument("clube", StringArgumentType.word()).suggests(CLUBES).then(Commands.argument("numero", IntegerArgumentType.integer(1, 99)).executes(c -> {
                Club cl = Clubs.get(StringArgumentType.getString(c, "clube"));
                int n = IntegerArgumentType.getInteger(c, "numero");
                if (cl == null) { c.getSource().sendFailure(Component.literal("Clube inválido. Use /futebol times.")); return 0; }
                for (Roster.Def df : cl.defs()) if (df.num() == n) { c.getSource().sendSuccess(() -> card(0, df, cl), false); return 1; }
                c.getSource().sendFailure(Component.literal("Esse time não tem camisa " + n + " entre os titulares. Use /futebol elenco " + cl.id()));
                return 0;
            }))));
        d.register(root);
    }

    static final com.mojang.brigadier.suggestion.SuggestionProvider<CommandSourceStack> CLUBES = (ctx, b) -> net.minecraft.commands.SharedSuggestionProvider.suggest(Clubs.ALL.keySet(), b);

    static int overallClube(Club c) { int s = 0; for (Roster.Def d : c.defs()) s += d.st().overall(d.pos()); return s / 11; }

    static int replay(CommandSourceStack src, int sec) {
        if (match == null || !match.startReplay(false, sec, 0.5)) { src.sendFailure(Component.literal("Ainda não há lance para repetir.")); return 0; }
        return 1;
    }

    static void sendCard(ServerPlayer pl, FPlayer p) { pl.sendSystemMessage(card(p.team, p.def, Roster.ATUAL[p.team])); }

    /** Ficha do jogador: melhor estatística em verde, pior em vermelho. */
    static Component card(int team, Roster.Def df, Club club) {
        Stats s = df.st();
        int best = s.melhor(df.pos()), worst = s.pior(df.pos());
        StringBuilder sb = new StringBuilder();
        sb.append(Roster.chat(club.chest())).append("§l#").append(df.num()).append(" ").append(df.nome())
          .append("§r §7").append(df.pos().nome).append(" §8| §e★ ").append(s.overall(df.pos())).append("\n");
        for (int i = 0; i < 10; i++) {
            if (i == 8 && df.pos() != Pos.GK) continue;
            int v = s.get(i);
            String cor = i == best ? "§a" : i == worst ? "§c" : "§f";
            String mark = i == best ? " ▲ melhor" : i == worst ? " ▼ pior" : "";
            int bars = v / 10;
            sb.append(" §7").append(String.format("%-18s", Stats.NOMES[i])).append(cor).append("█".repeat(bars)).append("§8").append("█".repeat(10 - bars))
              .append(" ").append(cor).append(v).append(mark).append("\n");
        }
        return Component.literal(sb.toString().stripTrailing());
    }
}
