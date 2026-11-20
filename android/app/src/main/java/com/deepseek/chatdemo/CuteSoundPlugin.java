package com.deepseek.chatdemo;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.SoundPool;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Map;

/**
 * 可爱音效播放器（原生层）
 *
 * 为什么不用 Web Audio：WebView 里 AudioContext 首次需要用户手势解锁，且
 * JS 合成 + 播放链路有几十毫秒抖动；SoundPool 预加载后播放延迟只有几毫秒，
 * 点击手感更好。此外「回桌面」时 WebView 已被系统挂起，只有原生生命周期
 * 回调（onUserLeaveHint）还来得及发声。
 *
 * JS 侧调用：Capacitor.Plugins.CuteSound.play({ name: 'tap', volume: 0.5 })
 * name 取值：tap / swipe / boot / home
 */
@CapacitorPlugin(name = "CuteSound")
public class CuteSoundPlugin extends Plugin {

    private static final String[] NAMES = { "tap", "swipe", "boot", "home" };

    private static SoundPool pool;
    private static final Map<String, Integer> SOUND_IDS = new HashMap<>();
    private static final Map<Integer, Boolean> LOADED = new HashMap<>();
    /** 每个音效当前正在播放的 streamId，播新的之前先停掉旧的，避免快速连点叠音 */
    private static final Map<String, Integer> STREAM_IDS = new HashMap<>();

    /** 首次播放时资源还没加载完，先记下来，加载完成回调里补播 */
    private static String pendingName;
    private static float pendingVolume;

    /** 初始化并预加载四个音效；可被 MainActivity 与插件重复调用，内部只做一次 */
    public static synchronized void ensurePool(Context context) {
        if (pool != null || context == null) return;

        AudioAttributes attrs =
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();

        pool = new SoundPool.Builder().setMaxStreams(4).setAudioAttributes(attrs).build();

        pool.setOnLoadCompleteListener(
                (soundPool, sampleId, status) -> {
                    LOADED.put(sampleId, status == 0);
                    if (status != 0) return;
                    if (pendingName == null) return;
                    Integer pendingId = SOUND_IDS.get(pendingName);
                    if (pendingId != null && pendingId == sampleId) {
                        playOnce(pendingName, sampleId, pendingVolume);
                        pendingName = null;
                    }
                });

        load(context, "tap", R.raw.cute_tap);
        load(context, "swipe", R.raw.cute_swipe);
        load(context, "boot", R.raw.cute_boot);
        load(context, "home", R.raw.cute_home);
    }

    private static void load(Context context, String name, int resId) {
        int id = pool.load(context, resId, 1);
        SOUND_IDS.put(name, id);
        LOADED.put(id, false);
    }

    /** 真正发声：先停掉该音效上一次的实例，避免点击过快时声音叠在一起 */
    private static void playOnce(String name, int soundId, float volume) {
        Integer last = STREAM_IDS.get(name);
        if (last != null && last > 0) pool.stop(last);
        int streamId = pool.play(soundId, volume, volume, 1, 0, 1f);
        if (streamId > 0) STREAM_IDS.put(name, streamId);
    }

    /** 播放指定音效；volume 0~1，线性缩放 */
    public static synchronized void playByName(Context context, String name, float volume) {
        if (context == null || name == null) return;
        ensurePool(context);
        if (pool == null) return;

        Integer id = SOUND_IDS.get(name);
        if (id == null) return;

        float v = Math.max(0f, Math.min(1f, volume));
        if (Boolean.TRUE.equals(LOADED.get(id))) {
            playOnce(name, id, v);
        } else {
            pendingName = name;
            pendingVolume = v;
        }
    }

    /** 释放资源（Activity 销毁时的兜底，一般不用调用） */
    public static synchronized void release() {
        if (pool != null) {
            pool.release();
            pool = null;
            SOUND_IDS.clear();
            LOADED.clear();
            STREAM_IDS.clear();
            pendingName = null;
        }
    }

    @PluginMethod
    public void play(PluginCall call) {
        String name = call.getString("name", "tap");
        float volume = call.getFloat("volume") == null ? 1f : call.getFloat("volume");
        playByName(getContext(), name, volume);
        call.resolve();
    }

    /** 供 JS 探测原生播放器是否就绪 */
    @PluginMethod
    public void isReady(PluginCall call) {
        com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
        ret.put("ready", pool != null);
        ret.put("names", NAMES);
        call.resolve(ret);
    }
}
