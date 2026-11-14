package com.futebol;

import net.minecraft.core.Holder;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/** Torcida de Villagers: pulam, olham a bola, cantam (bateria + melodia de cada clube) e reagem aos lances. */
public final class Crowd {
    private static final class Fan { Mob e; int team; int phase; }

    private final Match m;
    private final List<Fan> fans = new ArrayList<>();
    private final Random rnd = new Random();
    private int t, step;
    private final int[] cheer = new int[2], boo = new int[2], ooh = new int[2];
    private final int[][] melody = new int[2][16];
    private final boolean[][] rhythm = new boolean[2][16];
    public int count;

    public Crowd(Match m, int n) {
        this.m = m;
        for (int c = 0; c < 2; c++) {
            Random r = new Random(Roster.ATUAL[c].id().hashCode());
            int[] scale = {0, 2, 4, 7, 9, 12, 14, 16};
            int[] hook = new int[4];
            for (int i = 0; i < 4; i++) hook[i] = scale[r.nextInt(scale.length)];
            for (int i = 0; i < 16; i++) melody[c][i] = (i % 8 == 7) ? scale[r.nextInt(5)] : hook[i % 4];
            for (int i = 0; i < 16; i++) rhythm[c][i] = (i % 4 == 0) || r.nextInt(3) == 0;
        }
        fill(n);
    }

    public void fill(int n) {
        clear();
        List<Stadium.Seat> seats = new ArrayList<>(m.pitch.stadium.seats);
        java.util.Collections.shuffle(seats, rnd);
        int placed = 0, home = 0, away = 0;
        // casa e visitante em torcidas organizadas, o resto nas laterais
        for (Stadium.Seat s : seats) {
            if (placed >= n) break;
            int team;
            if (s.kind() == Stadium.END_HOME) { team = 0; if (home > n * 0.4) continue; home++; }
            else if (s.kind() == Stadium.END_AWAY) { team = 1; if (away > n * 0.4) continue; away++; }
            else team = rnd.nextInt(2);
            Mob e = EntityTypes.VILLAGER.create(m.level, EntitySpawnReason.COMMAND);
            e.removeFreeWill();
            e.setPermanentlyInvulnerable(true);
            e.setPersistenceRequired();
            e.addTag("futebol");
            e.addTag("futebol_fan");
            e.snapTo(s.pos().x, s.pos().y, s.pos().z, s.yaw(), 0);
            m.level.addFreshEntity(e);
            Fan f = new Fan(); f.e = e; f.team = team; f.phase = rnd.nextInt(12);
            fans.add(f); placed++;
        }
        count = placed;
    }

    public void clear() { for (Fan f : fans) f.e.discard(); fans.clear(); count = 0; }

    // ---------------------------------------------------------------- reações

    public void event(String type, int team) {
        Vec3 c0 = m.pitch.stadium.endCenter(0), c1 = m.pitch.stadium.endCenter(1);
        switch (type) {
            case "goal" -> {
                cheer[team] = 140; boo[1 - team] = 80;
                for (int i = 0; i < 6; i++) { sound(c0, SoundEvents.VILLAGER_CELEBRATE, 3f, 0.9f + rnd.nextFloat() * 0.4f); sound(c1, SoundEvents.VILLAGER_CELEBRATE, 3f, 0.9f + rnd.nextFloat() * 0.4f); }
                sound(m.pitch.stadium.endCenter(team), SoundEvents.FIREWORK_ROCKET_LARGE_BLAST, 4f, 1f);
            }
            case "chance" -> { ooh[0] = ooh[1] = 30; cheer[team] = Math.max(cheer[team], 24); sound(c0, SoundEvents.VILLAGER_AMBIENT, 3f, 1.5f); sound(c1, SoundEvents.VILLAGER_AMBIENT, 3f, 1.5f); }
            case "save" -> { boo[team] = 40; sound(m.pitch.stadium.endCenter(team), SoundEvents.VILLAGER_NO, 3f, 0.8f); cheer[1 - team] = 30; }
            case "foul" -> { boo[team] = 60; sound(c0, SoundEvents.VILLAGER_NO, 3f, 0.7f); sound(c1, SoundEvents.VILLAGER_NO, 3f, 0.7f); }
            case "skill" -> { cheer[team] = Math.max(cheer[team], 30); sound(m.pitch.stadium.endCenter(team), SoundEvents.VILLAGER_YES, 3f, 1.3f); }
            case "end" -> { cheer[0] = cheer[1] = 100; }
            default -> {}
        }
    }

    private void sound(Vec3 at, SoundEvent s, float vol, float pitch) {
        m.level.playSound(null, at.x, at.y, at.z, s, SoundSource.NEUTRAL, vol, pitch);
    }

    private void note(Vec3 at, Holder<SoundEvent> s, float vol, float semitone) {
        m.level.playSound(null, at.x, at.y, at.z, s, SoundSource.NEUTRAL, vol, (float) Math.pow(2, (semitone - 12) / 12.0));
    }

    // ---------------------------------------------------------------- por tick

    public void tick() {
        t++;
        for (int c = 0; c < 2; c++) { if (cheer[c] > 0) cheer[c]--; if (boo[c] > 0) boo[c]--; if (ooh[c] > 0) ooh[c]--; }
        Vec3 ball = m.bp();
        for (Fan f : fans) {
            Mob e = f.e;
            if (!e.isAlive()) continue;
            boolean jump = cheer[f.team] > 0 && (t + f.phase) % 12 == 0 && e.onGround();
            if (!jump && ooh[f.team] > 0 && (t + f.phase) % 20 == 0 && e.onGround() && rnd.nextInt(3) == 0) jump = true;
            if (jump) e.setDeltaMovement(0, 0.36, 0);
            if ((t + f.phase) % 10 == 0) {
                float yaw = Match.yawTo(ball.x - e.getX(), ball.z - e.getZ());
                e.setYRot(yaw); e.yBodyRot = yaw; e.setYHeadRot(yaw);
            }
        }
        if (t % 5 == 0) chant();
    }

    /** Bateria + melodia de cada torcida, mais forte quando o time está atacando. */
    private void chant() {
        int s = step++ & 15;
        boolean live = m.st == Match.St.PLAYING || m.st == Match.St.SETPIECE || m.st == Match.St.GOAL;
        if (!live) return;
        for (int c = 0; c < 2; c++) {
            double attack = 0;
            if (m.carrier != null && m.carrier.team == c) attack = Math.max(0, (m.U(c, m.carrier.pos().x) - 28) / 36.0);
            double vol = 0.55 + attack * 0.9 + (cheer[c] > 0 ? 0.8 : 0) - (boo[c] > 0 ? 0.3 : 0);
            if (m.st == Match.St.SETPIECE && m.spTeam != c) vol *= 0.6;
            Vec3 at = m.pitch.stadium.endCenter(c);
            if (s % 8 == 0) note(at, SoundEvents.NOTE_BLOCK_BASEDRUM, (float) vol * 3f, 12);
            if (s % 8 == 4) note(at, SoundEvents.NOTE_BLOCK_SNARE, (float) vol * 2.4f, 12);
            if (s % 2 == 1) note(at, SoundEvents.NOTE_BLOCK_HAT, (float) vol * 1.5f, 14);
            if (rhythm[c][s]) note(at, SoundEvents.NOTE_BLOCK_GUITAR, (float) vol * 2.2f, 6 + melody[c][s]);
            if (s == 0 && rnd.nextInt(2) == 0) sound(at, SoundEvents.VILLAGER_YES, (float) vol * 2f, 0.8f + rnd.nextFloat() * 0.5f);
        }
    }
}
