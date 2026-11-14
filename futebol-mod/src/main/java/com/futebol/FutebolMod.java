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
        }
        src.sendSuccess(() -> Component.literal("§a⚽ Campo montado! Os times estão em campo.\n§eClique com o botão direito com o §6Graveto do Árbitro §epara começar o jogo.\n§7Botão esquerdo na bola = chutar · Graveto num jogador = ver estatísticas · Graveto + agachar = reiniciar."), false);
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
