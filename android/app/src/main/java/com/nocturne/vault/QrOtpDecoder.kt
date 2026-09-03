package com.nocturne.vault

import android.graphics.Bitmap
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.BarcodeFormat

fun decodeOtpQr(bitmap: Bitmap): OtpItem {
    val width = bitmap.width
    val height = bitmap.height
    require(width in 1..MAX_QR_DIMENSION && height in 1..MAX_QR_DIMENSION) { "QR_TOO_LARGE" }
    require(width.toLong() * height.toLong() <= MAX_QR_PIXELS) { "QR_TOO_LARGE" }
    val pixels = IntArray(width * height)
    bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
    val source = RGBLuminanceSource(width, height, pixels)
    val reader = MultiFormatReader().apply {
        setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE), DecodeHintType.TRY_HARDER to true))
    }
    return Totp.parseUri(reader.decode(BinaryBitmap(HybridBinarizer(source))).text)
}

private const val MAX_QR_DIMENSION = 4_096
private const val MAX_QR_PIXELS = 16_777_216L
