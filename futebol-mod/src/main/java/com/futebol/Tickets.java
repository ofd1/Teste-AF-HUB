package com.futebol;

import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.CustomData;
import net.minecraft.world.phys.Vec3;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Ingressos (pagos em esmeraldas), setores, bilheteria e torcedor de clube. */
public final class Tickets {
    private Tickets() {}

    public record Sector(String id, String nome, int preco, int kind, String desc) {}

    public static final Sector[] SECTORS = {
        new Sector("geral", "Atrás do gol — torcida do mandante", 1, Stadium.END_HOME, "barulho e festa"),
        new Sector("visitante", "Atrás do gol — torcida visitante", 1, Stadium.END_AWAY, "setor visitante"),
        new Sector("central", "Arquibancada central", 3, Stadium.CENTRAL, "visão lateral completa"),
        new Sector("camarote", "Camarote VIP", 8, Stadium.VIP, "o melhor lugar, acima da linha do meio")
    };

    public static final Map<UUID, String> favorito = new HashMap<>();      // clube que cada jogador torce
    private static final Map<UUID, Vec3> seats = new HashMap<>();
    public static int vendidos, renda;

    public static Sector sector(String id) { for (Sector s : SECTORS) if (s.id().equals(id)) return s; return null; }

    public static Vec3 seatFor(Match m, ServerPlayer pl) {
        Vec3 s = seats.get(pl.getUUID());
        if (s != null) return s;
        List<Stadium.Seat> vip = m.pitch.stadium.ofKind(Stadium.VIP);
        return vip.isEmpty() ? new Vec3(m.pitch.cx(), m.pitch.surf() + 8, m.pitch.cz() - 30) : vip.get(vip.size() / 2).pos();
    }

    static int emeralds(ServerPlayer pl) {
        int n = 0;
        for (int i = 0; i < pl.getInventory().getContainerSize(); i++) { ItemStack s = pl.getInventory().getItem(i); if (s.is(Items.EMERALD)) n += s.getCount(); }
        return n;
    }

    static void take(ServerPlayer pl, int n) {
        for (int i = 0; i < pl.getInventory().getContainerSize() && n > 0; i++) {
            ItemStack s = pl.getInventory().getItem(i);
            if (s.is(Items.EMERALD)) { int k = Math.min(n, s.getCount()); s.shrink(k); n -= k; }
        }
    }

    public static boolean buy(Match m, ServerPlayer pl, Sector sec) {
        if (emeralds(pl) < sec.preco()) {
            pl.sendSystemMessage(Component.literal("§cIngresso " + sec.nome() + " custa §e" + sec.preco() + " esmeralda(s)§c. Você tem " + emeralds(pl) + "."));
            return false;
        }
        take(pl, sec.preco());
        vendidos++; renda += sec.preco();
        ItemStack t = new ItemStack(Items.PAPER);
        t.set(DataComponents.CUSTOM_NAME, Component.literal("§6§l🎫 Ingresso — " + sec.nome()));
        t.set(DataComponents.ENCHANTMENT_GLINT_OVERRIDE, true);
        CompoundTag tag = new CompoundTag();
        tag.putString("futebol_ingresso", sec.id());
        t.set(DataComponents.CUSTOM_DATA, CustomData.of(tag));
        pl.getInventory().add(t);
        pl.sendSystemMessage(Component.literal("§a🎫 Ingresso comprado: §f" + sec.nome() + " §7(" + sec.desc() + "). Clique com o botão direito no ingresso para ir ao seu lugar."));
        return true;
    }

    public static String sectorOf(ItemStack s) {
        if (!s.is(Items.PAPER)) return null;
        CustomData cd = s.get(DataComponents.CUSTOM_DATA);
        if (cd == null) return null;
        String id = cd.copyTag().getStringOr("futebol_ingresso", "");
        return id.isEmpty() ? null : id;
    }

    /** Usa o ingresso: leva o jogador ao assento do setor. */
    public static void use(Match m, ServerPlayer pl, String sectorId) {
        Sector sec = sector(sectorId);
        if (sec == null) return;
        List<Stadium.Seat> list = m.pitch.stadium.ofKind(sec.kind());
        if (list.isEmpty()) { pl.sendSystemMessage(Component.literal("§cSetor sem lugares.")); return; }
        Stadium.Seat s = list.get(Math.floorMod(pl.getUUID().hashCode(), list.size()));
        seats.put(pl.getUUID(), s.pos());
        pl.teleportTo(m.level, s.pos().x, s.pos().y, s.pos().z, java.util.Set.of(), s.yaw(), 10f, false);
        pl.sendSystemMessage(Component.literal("§a🏟 Bem-vindo ao setor §f" + sec.nome() + "§a! Bom jogo."));
    }

    public static void torcer(ServerPlayer pl, Club c) {
        favorito.put(pl.getUUID(), c.id());
        pl.sendSystemMessage(Component.literal("§a📣 Agora você torce para o §f" + c.nome() + "§a! Vamos cantar quando ele marcar."));
    }

    public static Component bilheteria() {
        return Component.literal("§6🎫 Bilheteria: §f" + vendidos + " ingressos vendidos · renda §e" + renda + " esmeraldas");
    }
}
