package com.watchdrift.ui

import android.app.Application
import android.net.Uri
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.watchdrift.core.Recorder
import com.watchdrift.core.Stats
import com.watchdrift.core.TapSolver
import com.watchdrift.data.AppData
import com.watchdrift.data.DataStore
import com.watchdrift.data.Profile
import com.watchdrift.data.Profiles
import com.watchdrift.data.Reading
import com.watchdrift.data.Watch
import com.watchdrift.ntp.NtpRepository
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class AppViewModel(app: Application) : AndroidViewModel(app) {

    private val store = DataStore(app)
    private val profiles = Profiles(app)
    val ntp = NtpRepository()

    private val _data = MutableStateFlow(AppData())
    val data: StateFlow<AppData> = _data.asStateFlow()

    private val _selectedWatchId = MutableStateFlow<String?>(null)
    val selectedWatchId: StateFlow<String?> = _selectedWatchId.asStateFlow()

    private val _message = MutableStateFlow("")
    val message: StateFlow<String> = _message.asStateFlow()

    /** Minute correction applied to the next reading; 0 means infer it. */
    private val _minuteAdjust = MutableStateFlow(0)
    val minuteAdjust: StateFlow<Int> = _minuteAdjust.asStateFlow()

    /** Armed by the user after resetting or syncing the watch itself. */
    private val _syncArm = MutableStateFlow(false)
    val syncArm: StateFlow<Boolean> = _syncArm.asStateFlow()

    // ── Tap mode ─────────────────────────────────────────────────────────────

    data class TapState(
        val active: Boolean = false,
        /** Monotonic timestamps, ms since boot. */
        val taps: List<Long> = emptyList(),
        val rejected: Int = 0
    )

    private val _tap = MutableStateFlow(TapState())
    val tap: StateFlow<TapState> = _tap.asStateFlow()

    init {
        _data.value = store.load()
        _selectedWatchId.value = _data.value.watches.firstOrNull()?.id
        syncNtp()
    }

    // ── NTP ──────────────────────────────────────────────────────────────────

    fun syncNtp() {
        viewModelScope.launch {
            ntp.sync()
        }
    }

    fun nextNtpServer() {
        ntp.nextServer()
        viewModelScope.launch { ntp.sync(tryOthers = false) }
    }

    // ── Selection ────────────────────────────────────────────────────────────

    fun selectWatch(id: String) {
        _selectedWatchId.value = id
        _minuteAdjust.value = 0
        _syncArm.value = false
    }

    fun selectedWatch(): Watch? = _data.value.watchById(_selectedWatchId.value)

    fun readingsForSelected(): List<Reading> =
        _selectedWatchId.value?.let { _data.value.readingsFor(it) } ?: emptyList()

    fun profileFor(watch: Watch?): Profile? = profiles.forWatch(watch)

    fun specSPerYear(watch: Watch?): Double? = profiles.specSPerYear(watch)

    fun toleranceS(watch: Watch?): Double = profiles.toleranceS(watch)

    fun rateInfo(watchId: String? = _selectedWatchId.value): Stats.RateInfo? {
        val rs = watchId?.let { _data.value.readingsFor(it) } ?: return null
        return Stats.watchRateInfo(rs)
    }

    // ── Watch management ─────────────────────────────────────────────────────

    fun addWatch(name: String) {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) {
            flash("Name cannot be empty.")
            return
        }
        val w = Watch(id = System.currentTimeMillis().toString(), name = trimmed)
        update { it.copy(watches = it.watches + w) }
        _selectedWatchId.value = w.id
        flash("Added '$trimmed'.")
    }

    /**
     * Deleting a watch deletes its readings with it. Those are timestamped
     * events that cannot be re-taken, so the UI must confirm before calling
     * this — there is no undo.
     */
    fun deleteWatch(id: String) {
        val name = _data.value.watchById(id)?.name ?: return
        val n = _data.value.readingsFor(id).size
        update {
            it.copy(
                watches = it.watches.filter { w -> w.id != id },
                readings = it.readings.filter { r -> r.watchId != id }
            )
        }
        if (_selectedWatchId.value == id) {
            _selectedWatchId.value = _data.value.watches.firstOrNull()?.id
        }
        flash("Deleted '$name' and $n reading(s).")
    }

    fun setWatchSpec(id: String, specSPerYear: Double?, toleranceS: Double?) {
        update { d ->
            d.copy(watches = d.watches.map { w ->
                if (w.id == id) w.copy(specSPerYear = specSPerYear, toleranceS = toleranceS) else w
            })
        }
        flash("Spec updated.")
    }

    // ── Minute adjust / sync arm ─────────────────────────────────────────────

    fun bumpMinuteAdjust(delta: Int) {
        _minuteAdjust.value += delta
    }

    fun clearMinuteAdjust() {
        _minuteAdjust.value = 0
    }

    /**
     * Flag the NEXT reading as taken right after the watch itself was changed
     * (crown set, reset, radio or Bluetooth sync). That starts a new segment.
     * Flagging a reading where the watch was NOT touched throws away the span
     * that gives the rate its precision.
     */
    fun toggleSyncArm() {
        _syncArm.value = !_syncArm.value
        flash(
            if (_syncArm.value) "Next reading flagged as post-sync (new segment)."
            else "Post-sync flag cleared."
        )
    }

    // ── Recording ────────────────────────────────────────────────────────────

    /** Single press: the user tapped at the instant the watch showed :00. */
    fun recordPress(elapsedRealtimeMs: Long = SystemClock.elapsedRealtime()) {
        val watch = selectedWatch() ?: run { flash("No watch selected."); return }
        val snap = ntp.state.value
        val t0 = snap.trueMsAtElapsed(elapsedRealtimeMs)
        commit(Recorder.build(
            watchId = watch.id,
            t0Ms = t0,
            snap = snap,
            history = _data.value.readingsFor(watch.id),
            manualMinuteAdjust = _minuteAdjust.value,
            postSync = _syncArm.value
        ))
    }

    fun startTapMode() {
        if (selectedWatch() == null) {
            flash("No watch selected.")
            return
        }
        _tap.value = TapState(active = true)
        flash("TAP MODE: tap on every tick, LAST tap at :00")
    }

    fun cancelTapMode(msg: String = "Tap mode cancelled.") {
        _tap.value = TapState()
        flash(msg)
    }

    /**
     * One tick.
     *
     * Timestamps come from the monotonic clock, not the wall clock: a wall
     * clock step landing mid-run would otherwise be fitted as watch drift.
     */
    fun onTap(elapsedRealtimeMs: Long = SystemClock.elapsedRealtime()) {
        val st = _tap.value
        if (!st.active) return
        val last = st.taps.lastOrNull()
        if (last != null && (elapsedRealtimeMs - last) < TapSolver.DEBOUNCE_MS) {
            _tap.value = st.copy(rejected = st.rejected + 1)
            return
        }
        _tap.value = st.copy(taps = st.taps + elapsedRealtimeMs)
        scheduleFinalize()
    }

    private var finalizeJob: kotlinx.coroutines.Job? = null

    private fun scheduleFinalize() {
        finalizeJob?.cancel()
        finalizeJob = viewModelScope.launch {
            delay(TapSolver.FINALIZE_AFTER_MS)
            finalizeTaps()
        }
    }

    private fun finalizeTaps() {
        val st = _tap.value
        if (!st.active || st.taps.isEmpty()) return
        val watch = selectedWatch() ?: run { cancelTapMode(); return }
        val snap = ntp.state.value

        // Convert monotonic taps to true time using the SAME sync snapshot the
        // reading will be labelled with.
        val trueTaps = st.taps.map { snap.trueMsAtElapsed(it) }

        when (val result = TapSolver.finalize(trueTaps)) {
            is TapSolver.Result.Rejected -> cancelTapMode(result.reason)
            is TapSolver.Result.Ok -> {
                _tap.value = TapState()
                commit(Recorder.build(
                    watchId = watch.id,
                    t0Ms = result.t0Ms,
                    snap = snap,
                    history = _data.value.readingsFor(watch.id),
                    manualMinuteAdjust = _minuteAdjust.value,
                    postSync = _syncArm.value,
                    tap = result
                ))
            }
        }
    }

    private fun commit(outcome: Recorder.Outcome) {
        val reading = outcome.reading
        if (reading == null) {
            flash(outcome.message)
            return
        }
        var pruned = 0
        update { d ->
            var readings = d.readings + reading
            if (reading.postSync) {
                val (kept, n) = Recorder.pruneStaleSyncs(readings, reading.watchId)
                readings = kept
                pruned = n
            }
            d.copy(readings = readings)
        }
        _minuteAdjust.value = 0
        _syncArm.value = false
        flash(
            outcome.message +
                (outcome.offTrendWarning?.let { "  ⚠ $it" } ?: "") +
                (if (pruned > 0) "  [$pruned old sync pruned]" else "")
        )
    }

    // ── Reading edits ────────────────────────────────────────────────────────

    /**
     * Change a reading's whole-minute correction. Used when the app guessed
     * the wrong minute, which shows as a large jump in the log.
     */
    fun adjustReading(readingId: String, deltaMinutes: Int) {
        update { d ->
            d.copy(readings = d.readings.map { r ->
                if (r.id != readingId) r
                else {
                    val adj = r.minuteAdjust + deltaMinutes
                    r.copy(
                        minuteAdjust = adj,
                        adjMode = "manual",
                        totalOffsetSec = round3(r.rawOffsetSec + adj * 60.0)
                    )
                }
            })
        }
        flash("Minute correction applied.")
    }

    fun deleteReading(readingId: String) {
        update { d -> d.copy(readings = d.readings.filter { it.id != readingId }) }
        flash("Reading deleted.")
    }

    /**
     * Toggle the post-sync flag on an existing reading.
     *
     * This is a segmentation change, not a cosmetic one: it splits or rejoins
     * the fit either side of this reading.
     */
    fun toggleReadingPostSync(readingId: String) {
        var now = false
        update { d ->
            d.copy(readings = d.readings.map { r ->
                if (r.id != readingId) r else {
                    now = !r.postSync
                    r.copy(postSync = now)
                }
            })
        }
        flash(if (now) "Marked as post-sync — starts a new segment." else "Post-sync flag removed.")
    }

    // ── Import / export ──────────────────────────────────────────────────────

    fun importData(uri: Uri, merge: Boolean) {
        val incoming = store.importFrom(uri)
        if (incoming == null) {
            flash("Could not read that file — is it a watch_drift.json?")
            return
        }
        val before = _data.value.readings.size
        val merged = if (merge) store.merge(_data.value, incoming) else incoming
        _data.value = merged
        store.save(merged)
        if (_selectedWatchId.value == null || merged.watchById(_selectedWatchId.value) == null) {
            _selectedWatchId.value = merged.watches.firstOrNull()?.id
        }
        flash(
            if (merge) "Merged: ${merged.readings.size - before} new reading(s), " +
                "${merged.readings.size} total."
            else "Replaced: ${merged.readings.size} reading(s)."
        )
    }

    fun exportData(uri: Uri) {
        flash(
            if (store.exportTo(uri, _data.value)) "Exported ${_data.value.readings.size} reading(s)."
            else "Export failed."
        )
    }

    // ── Plumbing ─────────────────────────────────────────────────────────────

    private fun update(block: (AppData) -> AppData) {
        val next = block(_data.value)
        _data.value = next
        store.save(next)
    }

    fun flash(msg: String) {
        _message.value = msg
    }

    fun clearMessage() {
        _message.value = ""
    }

    private fun round3(v: Double) = Math.round(v * 1000.0) / 1000.0
}
