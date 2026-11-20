package com.deepseek.chatdemo;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Display;
import android.view.RoundedCorner;
import android.view.Window;
import android.webkit.JavascriptInterface;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

/**
 * 内容铺满整屏（edge-to-edge）：状态栏区域交给页面自己绘制，控件整体下移避让，
 * 而不是在 WebView 外面垫一条系统栏高度的底色。
 *
 * <p>系统栏的实际高度通过 {@code window.AndroidInsets} 交给 Web 端（物理像素，
 * 由 JS 按 devicePixelRatio 换算成 CSS 像素），写进 --safe-top / --safe-bottom。
 */
public class MainActivity extends BridgeActivity {

    private volatile int safeTop = 0;
    private volatile int safeBottom = 0;

    @Override
    @SuppressWarnings("deprecation")
    public void onCreate(Bundle savedInstanceState) {
        // 必须在 super.onCreate 之前放开，避免先按安全区布局、再整体跳一次
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        Window window = getWindow();
        // 两条系统栏都透明，页面自己画到屏幕边缘（Android 15 起由系统强制，这里兜住更旧的版本）
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
        }
        super.onCreate(savedInstanceState);

        ViewCompat.setOnApplyWindowInsetsListener(getBridge().getWebView(), (view, windowInsets) -> {
            Insets insets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            safeTop = insets.top;
            safeBottom = insets.bottom;
            // 不消费，继续交给 Capacitor 自己处理键盘等其余 inset
            return windowInsets;
        });
        getBridge().getWebView().addJavascriptInterface(new InsetsBridge(), "AndroidInsets");
    }

    public class InsetsBridge {

        @JavascriptInterface
        public int top() {
            return safeTop;
        }

        @JavascriptInterface
        public int bottom() {
            return safeBottom;
        }

        /**
         * 屏幕圆角半径（物理像素）。聊天卡片与手机边框贴合的圆角要跟系统值一致，
         * 写死的话在圆角更大的机型上会顶出去、更小的机型上会留缺口。
         */
        @JavascriptInterface
        public int cornerRadius() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                try {
                    Display display = getWindowManager().getDefaultDisplay();
                    RoundedCorner corner = display.getRoundedCorner(RoundedCorner.POSITION_BOTTOM_LEFT);
                    if (corner != null) {
                        return corner.getRadius();
                    }
                } catch (Exception e) {
                    Log.w("InsetsBridge", "cornerRadius unavailable", e);
                }
            }
            return 0;
        }

        /**
         * 系统字号比例（设置 → 显示 → 字体大小）。WebView 自己不会跟着系统字号走，
         * 页面上的「字体大小 → 跟随系统」读这个值。
         */
        @JavascriptInterface
        public float fontScale() {
            return getResources().getConfiguration().fontScale;
        }
    }
}
