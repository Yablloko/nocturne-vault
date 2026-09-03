package com.nocturne.vault

import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

internal object SafeDebugLog {
    private const val PREFS = "safe_debug_log"
    private const val ENABLED = "enabled"
    private const val ENTRIES = "entries"
    private const val MAX_ENTRIES = 200

    private fun storage(context: Context) = context.createDeviceProtectedStorageContext()
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isEnabled(context: Context): Boolean = storage(context).getBoolean(ENABLED, false)

    fun setEnabled(context: Context, enabled: Boolean) {
        val preferences = storage(context)
        if (enabled) {
            preferences.edit().putBoolean(ENABLED, true).commit()
            record(context, "diagnostics.enabled")
        } else {
            preferences.edit().putBoolean(ENABLED, false).remove(ENTRIES).commit()
        }
    }

    @Synchronized
    fun record(context: Context, event: String, vararg fields: Pair<String, Any?>) {
        val preferences = storage(context)
        if (!preferences.getBoolean(ENABLED, false)) return
        val current = runCatching { JSONArray(preferences.getString(ENTRIES, "[]")) }.getOrDefault(JSONArray())
        val next = JSONArray()
        val first = (current.length() - MAX_ENTRIES + 1).coerceAtLeast(0)
        for (index in first until current.length()) next.put(current.optJSONObject(index))
        val values = JSONObject()
        fields.forEach { (key, value) -> values.put(safeToken(key), safeValue(value)) }
        next.put(
            JSONObject()
                .put("time", System.currentTimeMillis())
                .put("event", safeToken(event))
                .put("values", values),
        )
        preferences.edit().putString(ENTRIES, next.toString()).apply()
    }

    @Suppress("DEPRECATION")
    fun report(context: Context): String {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        val entries = runCatching { JSONArray(storage(context).getString(ENTRIES, "[]")) }.getOrDefault(JSONArray())
        return buildString {
            appendLine("Nocturne diagnostics")
            appendLine("package=${context.packageName}")
            appendLine("version=${info.versionName} (${if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()})")
            appendLine("android=${Build.VERSION.SDK_INT}")
            appendLine("device=${safeValue(Build.MANUFACTURER)} ${safeValue(Build.MODEL)}")
            appendLine("entries=${entries.length()}")
            for (index in 0 until entries.length()) {
                val entry = entries.optJSONObject(index) ?: continue
                append(Instant.ofEpochMilli(entry.optLong("time")))
                append(' ')
                append(entry.optString("event"))
                val values = entry.optJSONObject("values")
                if (values != null && values.length() > 0) {
                    append(' ')
                    append(values.toString())
                }
                appendLine()
            }
        }
    }

    fun failureCode(failure: Throwable): String {
        val message = failure.message.orEmpty()
        return if (message.matches(Regex("[A-Z0-9_:.,-]{1,96}"))) message else failure.javaClass.simpleName
    }

    private fun safeToken(value: String): String = value.replace(Regex("[^A-Za-z0-9_.:-]"), "_").take(96)

    private fun safeValue(value: Any?): String = value?.toString()
        ?.replace(Regex("[\\r\\n\\t]"), " ")
        ?.take(120)
        .orEmpty()
}
