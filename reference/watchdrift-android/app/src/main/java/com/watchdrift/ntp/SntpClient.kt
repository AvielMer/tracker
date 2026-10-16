package com.watchdrift.ntp

import android.os.SystemClock
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

/**
 * Minimal SNTP (RFC 4330) client. Replaces Python's ntplib.
 *
 * Android has a built-in SntpClient but it is hidden API and gives no access
 * to the round-trip delay, which this app records per reading as a quality
 * figure and folds into the error budget.
 *
 * The critical Android-specific part is [Sample.elapsedRealtimeAtResponseMs]:
 * the phone's wall clock can be stepped at any moment by the OS, by the
 * network operator, or by the user. Anchoring to SystemClock.elapsedRealtime()
 * — monotonic since boot, unaffected by clock changes — means a wall-clock
 * jump mid-session cannot silently corrupt a reading. The Python version
 * stored a wall-clock offset and was exposed to exactly that.
 */
object SntpClient {

    private const val NTP_PORT = 123
    private const val NTP_PACKET_SIZE = 48
    private const val NTP_MODE_CLIENT = 3
    private const val NTP_VERSION = 3
    /** Seconds between 1900 (NTP epoch) and 1970 (Unix epoch). */
    private const val OFFSET_1900_TO_1970 = 2208988800L

    data class Sample(
        /** True time minus device wall clock, in ms. */
        val offsetMs: Double,
        /** Round-trip delay, in ms. */
        val delayMs: Double,
        val server: String,
        /** Monotonic clock reading at the instant the response was received. */
        val elapsedRealtimeAtResponseMs: Long,
        /** True unix time in ms at that same instant. */
        val trueTimeAtResponseMs: Double
    )

    /**
     * One request. Throws on timeout or a malformed reply.
     */
    fun request(server: String, timeoutMs: Int = 4000): Sample {
        DatagramSocket().use { socket ->
            socket.soTimeout = timeoutMs
            val address = InetAddress.getByName(server)
            val buffer = ByteArray(NTP_PACKET_SIZE)

            // LI = 0, VN = 3, Mode = 3 (client)
            buffer[0] = (NTP_VERSION shl 3 or NTP_MODE_CLIENT).toByte()

            val requestElapsed = SystemClock.elapsedRealtime()
            val requestWall = System.currentTimeMillis()
            writeTimestamp(buffer, 40, requestWall)

            socket.send(DatagramPacket(buffer, buffer.size, address, NTP_PORT))

            val response = DatagramPacket(buffer, buffer.size)
            socket.receive(response)

            val responseElapsed = SystemClock.elapsedRealtime()
            // Derive the response wall time from the monotonic delta rather
            // than reading the wall clock again: if the clock stepped between
            // send and receive, a second read would corrupt the round trip.
            val responseWall = requestWall + (responseElapsed - requestElapsed)

            val originate = readTimestamp(buffer, 24)   // T1 as echoed back
            val receive = readTimestamp(buffer, 32)     // T2, server receive
            val transmit = readTimestamp(buffer, 40)    // T3, server transmit

            if (transmit == 0L) throw IllegalStateException("$server: zero transmit timestamp")

            // Standard NTP: delay = (T4-T1) - (T3-T2), offset = ((T2-T1)+(T3-T4))/2
            val t1 = if (originate != 0L) originate else requestWall
            val delay = (responseWall - t1) - (transmit - receive)
            val offset = ((receive - t1) + (transmit - responseWall)) / 2.0

            return Sample(
                offsetMs = offset,
                delayMs = delay.toDouble(),
                server = server,
                elapsedRealtimeAtResponseMs = responseElapsed,
                trueTimeAtResponseMs = responseWall + offset
            )
        }
    }

    /**
     * Best of [samples] requests, chosen by lowest round-trip delay.
     *
     * NTP infers the offset assuming network delay is symmetric out and back.
     * A VPN breaks that: traffic leaves through a distant endpoint and the
     * return path can differ, biasing the result by roughly half the asymmetry
     * — hundreds of ms is realistic. The lowest-delay sample is the least
     * likely to be distorted, and the delay itself is worth recording as a
     * quality figure.
     */
    fun bestOf(server: String, samples: Int = 4, timeoutMs: Int = 4000): Sample {
        var best: Sample? = null
        var lastErr: Exception? = null
        repeat(samples) {
            try {
                val s = request(server, timeoutMs)
                if (best == null || s.delayMs < best!!.delayMs) best = s
            } catch (e: Exception) {
                lastErr = e
            }
        }
        return best ?: throw (lastErr ?: IllegalStateException("$server: no reply"))
    }

    private fun writeTimestamp(buffer: ByteArray, offset: Int, timeMs: Long) {
        val seconds = timeMs / 1000L + OFFSET_1900_TO_1970
        val ms = timeMs % 1000L
        val fraction = ms * 0x100000000L / 1000L
        for (i in 0 until 4) {
            buffer[offset + i] = (seconds shr (24 - i * 8)).toByte()
        }
        for (i in 0 until 4) {
            buffer[offset + 4 + i] = (fraction shr (24 - i * 8)).toByte()
        }
    }

    private fun readTimestamp(buffer: ByteArray, offset: Int): Long {
        var seconds = 0L
        for (i in 0 until 4) {
            seconds = seconds shl 8 or (buffer[offset + i].toLong() and 0xffL)
        }
        var fraction = 0L
        for (i in 0 until 4) {
            fraction = fraction shl 8 or (buffer[offset + 4 + i].toLong() and 0xffL)
        }
        if (seconds == 0L && fraction == 0L) return 0L
        return (seconds - OFFSET_1900_TO_1970) * 1000L + fraction * 1000L / 0x100000000L
    }
}
