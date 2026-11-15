package ar.pasajeros.conductor;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DeviceStatusPlugin.class);   // batería, WiFi, GPS y señal de cada SIM para la barra superior
        super.onCreate(savedInstanceState);
        // Pantalla siempre encendida mientras la app está abierta (el GPS del WebView solo funciona con pantalla encendida).
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // La app dibuja detrás de las barras del sistema: al ocultarlas, el contenido ocupa toda la pantalla (sin franja vacía arriba).
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
        getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        // El contenido llega hasta el borde superior, también detrás de la cámara frontal; la barra de estado esquiva esa zona.
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();   // vuelve a ocultar las barras al volver a la app
    }

    // Pantalla completa: sin barra de estado ni botones del sistema. Deslizando desde el borde aparecen unos segundos y se ocultan solas.
    private void hideSystemBars() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
