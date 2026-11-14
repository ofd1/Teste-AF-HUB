package com.futebol;

import net.minecraft.world.entity.Mob;
import net.minecraft.world.phys.Vec3;

/** Um jogador em campo: a entidade + estado de IA/físico. */
public final class FPlayer {
    public enum Mode { HOLD, PRESS, MARK, CHASE, RECEIVE, CARRY, RUN, GK, SETPIECE }

    public final int team;
    public final Roster.Def def;
    public Mob e;

    // movimento
    public double vx, vz;               // velocidade horizontal própria (blocos/tick)
    public double fx = 1, fz = 0;       // direção que está encarando
    public double energy = 1.0;
    // intenção
    public double tx, tz, spd = 0.5;    // alvo e fração da velocidade máxima
    public Mode mode = Mode.HOLD;
    // temporizadores
    public int touchCd, tackleCd, stun, headCd, ctrlTicks, shoutCd;
    // goleiro
    public boolean holding;
    public int holdTicks, holdMax;
    public boolean shotActive;
    public double aimZ, aimY;
    public int shotTicks, shotReact;
    public boolean jumped;
    public int yellow; public boolean out;            // cartões
    public double swX, swZ; public int swTicks;       // movimentação sutil sem bola
    public int giveGoTicks; public FPlayer giveGoTarget;
    // dribles / fintas
    public int skillTicks, skillSplit, skillType, skillCd;
    public double skillSide, boost = 1.0;
    public boolean skillResolved;
    public double skillFx, skillFz;
    public FPlayer skillTarget;

    public FPlayer(int team, Roster.Def def) { this.team = team; this.def = def; }

    public Stats st() { return def.st(); }
    public boolean isGK() { return def.pos() == Pos.GK; }
    public Vec3 pos() { return e.position(); }

    /** Velocidade máxima (blocos/tick), levando o fôlego em conta. */
    public double maxSpeed() {
        double v = (0.15 + 0.0017 * st().vel()) * RITMO;
        v *= 0.82 + 0.18 * energy;
        if (isGK()) v *= 0.82;
        if (stun > 0) v *= 0.45;
        return v;
    }

    public double accel() { return (0.03 + 0.0004 * st().vel()) * Math.max(0.6, RITMO); }

    /** Ritmo do jogo (1.0 = padrão): multiplica a velocidade dos jogadores. */
    public static double RITMO = 1.0;
}
