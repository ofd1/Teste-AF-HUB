package com.futebol;

import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.phys.Vec3;

/** Trio de arbitragem: árbitro (segue o jogo na diagonal) e dois bandeirinhas (na linha de impedimento). */
public final class Referee {
    private final Match m;
    private final Mob[] mobs = new Mob[3];
    private final double[] vx = new double[3], vz = new double[3];

    public Referee(Match m) {
        this.m = m;
        String[] nomes = {"§e§l⚑ Árbitro", "§e⚑ Assistente", "§e⚑ Assistente"};
        for (int i = 0; i < 3; i++) {
            Mob e = EntityTypes.EVOKER.create(m.level, EntitySpawnReason.COMMAND);
            e.removeFreeWill();
            e.setPermanentlyInvulnerable(true);
            e.setPersistenceRequired();
            e.setCanPickUpLoot(false);
            e.setSilent(true);
            e.addTag("futebol");
            e.setItemSlot(EquipmentSlot.CHEST, Match.dyed(net.minecraft.world.item.Items.LEATHER_CHESTPLATE, i == 0 ? 0x111111 : 0xF2C500));
            e.setItemSlot(EquipmentSlot.LEGS, Match.dyed(net.minecraft.world.item.Items.LEATHER_LEGGINGS, 0x111111));
            e.setItemSlot(EquipmentSlot.FEET, Match.dyed(net.minecraft.world.item.Items.LEATHER_BOOTS, 0x111111));
            for (EquipmentSlot s : EquipmentSlot.values()) if (s.isArmor()) e.setDropChance(s, 0f);
            e.setCustomName(Component.literal(nomes[i]));
            e.setCustomNameVisible(i == 0);
            Pitch p = m.pitch;
            e.snapTo(p.cx() + (i == 0 ? 0 : (i == 1 ? -10 : 10)), p.surf(), p.cz() + (i == 2 ? -Pitch.HALF_W - 1.5 : (i == 0 ? 6 : Pitch.HALF_W + 1.5)), 0, 0);
            m.level.addFreshEntity(e);
            mobs[i] = e;
        }
    }

    public void remove() { for (Mob e : mobs) if (e != null) e.discard(); }

    private void move(int i, double tx, double tz, double max) {
        Mob e = mobs[i];
        if (!e.isAlive()) return;
        double dx = tx - e.getX(), dz = tz - e.getZ(), d = Math.hypot(dx, dz);
        double want = Math.min(max, d * 0.15);
        double wx = d > 1e-6 ? dx / d * want : 0, wz = d > 1e-6 ? dz / d * want : 0;
        vx[i] += (wx - vx[i]) * 0.12; vz[i] += (wz - vz[i]) * 0.12;
        e.setDeltaMovement(vx[i], e.getDeltaMovement().y, vz[i]);
        Vec3 b = m.bp();
        double lx = Math.hypot(vx[i], vz[i]) > 0.05 ? vx[i] : b.x - e.getX(), lz = Math.hypot(vx[i], vz[i]) > 0.05 ? vz[i] : b.z - e.getZ();
        float yaw = Match.yawTo(lx, lz);
        e.setYRot(yaw); e.yBodyRot = yaw; e.setYHeadRot(yaw);
    }

    public void tick() {
        Pitch p = m.pitch;
        Vec3 b = m.st == Match.St.SETPIECE ? m.spSpot : m.bp();
        double cx = p.cx(), cz = p.cz(), HL = Pitch.HALF_L, HW = Pitch.HALF_W;
        boolean intro = m.st == Match.St.INTRO;
        // árbitro: fica na diagonal do jogo, ~9 blocos da bola, do lado da câmera principal quando possível
        double ang = Math.atan2(b.z - cz, b.x - cx);
        double tx = b.x - Math.signum(b.x - cx) * 6, tz = b.z + (b.z >= cz ? -9 : 9);
        if (m.carrier != null) { tx = b.x - m.attackDir[m.carrier.team] * 7; }
        if (intro || m.st == Match.St.IDLE) { tx = cx + 0.5; tz = cz + 3.5; }
        tx = Math.max(cx - HL + 3, Math.min(cx + HL - 3, tx)); tz = Math.max(cz - HW + 3, Math.min(cz + HW - 3, tz));
        move(0, tx, tz, 0.17 + (m.carrier != null ? Math.hypot(m.carrier.vx, m.carrier.vz) * 0.4 : 0));
        // assistentes: linha de impedimento do time que ataca aquele lado
        for (int k = 1; k <= 2; k++) {
            int dir = k == 1 ? 1 : -1;                    // meio-campo +x e meio-campo -x
            double line;
            if (intro || m.st == Match.St.IDLE) line = cx + dir * 10;
            else {
                int atk = m.attackDir[0] == dir ? 0 : 1;   // time que ataca para esse lado
                // última linha defensiva adversária em x
                double xl = cx + dir * 12;
                double best = -1e9;
                for (FPlayer o : m.teams[1 - atk]) { if (o.isGK()) continue; double s = (o.pos().x - cx) * dir; if (s > best) { best = s; xl = o.pos().x; } }
                line = best > 0 ? xl : cx + dir * 12;
            }
            double zz = cz + (k == 1 ? HW + 1.6 : -HW - 1.6);
            move(k, Math.max(cx - HL, Math.min(cx + HL, line)), zz, 0.2);
        }
    }
}
