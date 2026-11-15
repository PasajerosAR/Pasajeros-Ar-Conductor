package ar.pasajeros.conductor;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.graphics.Rect;
import android.os.BatteryManager;
import android.os.Build;
import android.telephony.SignalStrength;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;
import android.view.DisplayCutout;
import android.view.WindowInsets;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.List;

/**
 * Estado del teléfono para la barra superior de la app: batería, WiFi, GPS y señal de cada SIM.
 * La señal y el nombre de la operadora de cada SIM necesitan el permiso READ_PHONE_STATE; sin él se muestra una sola red móvil.
 */
@CapacitorPlugin(
    name = "DeviceStatus",
    permissions = { @Permission(alias = "phone", strings = { Manifest.permission.READ_PHONE_STATE }) }
)
public class DeviceStatusPlugin extends Plugin {

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        ret.put("battery", battery(ctx));
        ret.put("wifi", wifi(ctx));
        ret.put("sims", sims(ctx));
        ret.put("mobileConnected", hasTransport(ctx, NetworkCapabilities.TRANSPORT_CELLULAR));
        ret.put("gpsEnabled", gpsEnabled(ctx));
        ret.put("cutout", cutout(ctx));
        ret.put("phonePermission", getPermissionState("phone") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    private JSObject battery(Context ctx) {
        JSObject b = new JSObject();
        Intent i = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        int pct = -1;
        boolean charging = false;
        if (i != null) {
            int level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            if (level >= 0 && scale > 0) pct = Math.round(level * 100f / scale);
            int status = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL;
        }
        b.put("level", pct);
        b.put("charging", charging);
        return b;
    }

    private boolean hasTransport(Context ctx, int transport) {
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities c = cm.getNetworkCapabilities(n);
                if (c != null && c.hasTransport(transport) && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return true;
            }
        } catch (Exception e) {
            // sin dato: se informa como desconectado
        }
        return false;
    }

    @SuppressWarnings("deprecation")
    private JSObject wifi(Context ctx) {
        JSObject w = new JSObject();
        boolean enabled = false;
        int level = -1;
        try {
            WifiManager wm = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                enabled = wm.isWifiEnabled();
                boolean connected = hasTransport(ctx, NetworkCapabilities.TRANSPORT_WIFI);
                if (enabled && connected) {
                    WifiInfo info = wm.getConnectionInfo();
                    if (info != null) level = WifiManager.calculateSignalLevel(info.getRssi(), 5);   // 0 a 4
                }
            }
        } catch (Exception e) {
            // sin dato
        }
        w.put("enabled", enabled);
        w.put("connected", level >= 0);
        w.put("level", level);
        return w;
    }

    private int signalLevel(TelephonyManager tm) {
        try {
            if (tm != null && Build.VERSION.SDK_INT >= 28) {
                SignalStrength s = tm.getSignalStrength();
                if (s != null) return s.getLevel();   // 0 a 4
            }
        } catch (Exception e) {
            // sin permiso o sin dato
        }
        return -1;
    }

    private String networkType(TelephonyManager tm) {
        try {
            if (tm == null || Build.VERSION.SDK_INT < 24) return "";
            switch (tm.getDataNetworkType()) {
                case TelephonyManager.NETWORK_TYPE_NR: return "5G";
                case TelephonyManager.NETWORK_TYPE_LTE: return "4G";
                case TelephonyManager.NETWORK_TYPE_HSPAP:
                case TelephonyManager.NETWORK_TYPE_HSPA:
                case TelephonyManager.NETWORK_TYPE_HSDPA:
                case TelephonyManager.NETWORK_TYPE_HSUPA:
                case TelephonyManager.NETWORK_TYPE_UMTS: return "3G";
                case TelephonyManager.NETWORK_TYPE_EDGE:
                case TelephonyManager.NETWORK_TYPE_GPRS: return "2G";
                default: return "";
            }
        } catch (Exception e) {
            return "";
        }
    }

    private JSArray sims(Context ctx) {
        JSArray list = new JSArray();
        try {
            TelephonyManager tm = (TelephonyManager) ctx.getSystemService(Context.TELEPHONY_SERVICE);
            if (tm == null) return list;
            if (getPermissionState("phone") == PermissionState.GRANTED && Build.VERSION.SDK_INT >= 24) {
                SubscriptionManager sm = (SubscriptionManager) ctx.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
                List<SubscriptionInfo> subs = sm != null ? sm.getActiveSubscriptionInfoList() : null;
                if (subs != null) {
                    int dataSub = SubscriptionManager.getDefaultDataSubscriptionId();
                    for (SubscriptionInfo info : subs) {
                        TelephonyManager t = tm.createForSubscriptionId(info.getSubscriptionId());
                        JSObject s = new JSObject();
                        s.put("slot", info.getSimSlotIndex() + 1);
                        CharSequence name = info.getCarrierName();
                        s.put("carrier", name != null ? name.toString() : "");
                        s.put("level", signalLevel(t));
                        s.put("type", networkType(t));
                        s.put("data", info.getSubscriptionId() == dataSub);
                        list.put(s);
                    }
                }
            }
            if (list.length() == 0 && tm.getSimState() == TelephonyManager.SIM_STATE_READY) {
                JSObject s = new JSObject();
                s.put("slot", 1);
                s.put("carrier", tm.getNetworkOperatorName());
                s.put("level", signalLevel(tm));
                s.put("type", networkType(tm));
                s.put("data", true);
                list.put(s);
            }
        } catch (Exception e) {
            // sin datos de SIM
        }
        return list;
    }

    /** Zona de la cámara frontal en el borde superior, en píxeles CSS (dp): left, right y bottom. Vacío si no hay muesca arriba. */
    private JSObject cutout(Context ctx) {
        JSObject c = new JSObject();
        try {
            if (Build.VERSION.SDK_INT >= 28 && getActivity() != null) {
                WindowInsets insets = getActivity().getWindow().getDecorView().getRootWindowInsets();
                DisplayCutout dc = insets != null ? insets.getDisplayCutout() : null;
                if (dc != null) {
                    float density = ctx.getResources().getDisplayMetrics().density;
                    int left = Integer.MAX_VALUE, right = 0, bottom = 0;
                    for (Rect r : dc.getBoundingRects()) {
                        if (r.top > 0) continue;   // solo lo que toca el borde superior
                        left = Math.min(left, r.left);
                        right = Math.max(right, r.right);
                        bottom = Math.max(bottom, r.bottom);
                    }
                    if (right > left) {
                        c.put("left", Math.round(left / density));
                        c.put("right", Math.round(right / density));
                        c.put("bottom", Math.round(bottom / density));
                    }
                }
            }
        } catch (Exception e) {
            // sin dato de muesca
        }
        return c;
    }

    private boolean gpsEnabled(Context ctx) {
        try {
            LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            return lm != null && lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
        } catch (Exception e) {
            return false;
        }
    }
}
