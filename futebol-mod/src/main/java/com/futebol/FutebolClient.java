package com.futebol;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Ferramenta de desenvolvimento (FUTEBOL_SHOTS=pasta): tira capturas de tela quando o servidor manda "SHOT:nome". */
public class FutebolClient implements ClientModInitializer {
    private record Pending(String name, int[] left) {}

    @Override
    public void onInitializeClient() {
        String dir = System.getenv("FUTEBOL_SHOTS");
        if (dir == null) return;
        List<Pending> pend = new ArrayList<>();
        ClientReceiveMessageEvents.GAME.register((msg, overlay) -> {
            String s = msg.getString();
            if (s.startsWith("SHOT:")) pend.add(new Pending(s.substring(5).trim(), new int[]{6}));
        });
        int[] n = {0};
        ClientTickEvents.END_CLIENT_TICK.register(mc -> {
            if (++n[0] % 60 == 0 && mc.player != null) {
                var ce = mc.getCameraEntity();
                FutebolMod.LOG.info("CLIENTCAM camera={} id={} ehJogador={} pos=({},{},{}) yaw={}", ce == null ? "null" : ce.getClass().getSimpleName(), ce == null ? -1 : ce.getId(), ce == mc.player,
                    ce == null ? 0 : (int) ce.getX(), ce == null ? 0 : (int) ce.getY(), ce == null ? 0 : (int) ce.getZ(), ce == null ? 0 : (int) ce.getYRot());
            }
            for (var it = pend.iterator(); it.hasNext(); ) {
                Pending p = it.next();
                if (--p.left()[0] > 0) continue;
                it.remove();
                try {
                    Path out = Path.of(dir, p.name() + ".png");
                    Files.createDirectories(out.getParent());
                    Screenshot.takeScreenshot(Minecraft.getInstance().gameRenderer.mainRenderTarget(), img -> {
                        try { img.writeToFile(out); img.close(); } catch (Exception e) { FutebolMod.LOG.error("shot", e); }
                    });
                } catch (Exception e) { FutebolMod.LOG.error("shot", e); }
            }
        });
    }
}
