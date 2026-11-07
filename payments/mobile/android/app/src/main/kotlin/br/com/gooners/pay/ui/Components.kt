package br.com.gooners.pay.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.FilterChip
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import br.com.gooners.pay.core.Money
import br.com.gooners.pay.core.api.RecentPayment
import br.com.gooners.pay.core.today.Today
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// The building blocks the screens share (docs/06 §6): a card per section, small caps labels,
// figures with tabular digits, status chips whose word carries the meaning, and the day's
// charts in the chart colours of the tokens.

/** A section on its own surface; one primary action at most. */
@Composable
fun SectionCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) = Column(
    modifier.fillMaxWidth()
        .clip(RoundedCornerShape(Radius.Lg))
        .background(semantic.surface)
        .border(1.dp, semantic.border, RoundedCornerShape(Radius.Lg))
        .padding(Space.Lg),
    verticalArrangement = Arrangement.spacedBy(Space.Sm),
    content = content,
)

/** A small caps label over a figure. */
@Composable
fun Overline(text: String, modifier: Modifier = Modifier) =
    Text(text.uppercase(Locale.forLanguageTag("pt-BR")), style = TypeScale.Overline, color = semantic.textSecondary, modifier = modifier)

/** A card's heading, with an optional link on the right. */
@Composable
fun CardHeader(title: String, trailing: String? = null, onTrailing: (() -> Unit)? = null) =
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f).semantics { heading() })
        if (trailing != null) {
            val m = if (onTrailing != null) Modifier.heightIn(min = Tokens.TouchMin).clickable(role = Role.Button, onClick = onTrailing) else Modifier
            Box(m, contentAlignment = Alignment.Center) {
                Text(trailing, style = TypeScale.Label, color = if (onTrailing != null) semantic.infoText else semantic.textSecondary)
            }
        }
    }

/** A key figure: a label, the number, and a line under it. */
@Composable
fun Kpi(label: String, value: String, modifier: Modifier = Modifier, lead: Boolean = false, color: Color = semantic.textPrimary,
    spoken: String? = null, below: @Composable () -> Unit = {}) = Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
    Overline(label)
    // A figure never truncates: it shrinks to fit its column instead (docs/06 §4).
    val style = (if (lead) TypeScale.Kpi else TypeScale.Title.copy(fontFeatureSettings = "tnum")).copy(color = color)
    BasicText(value, style = style, maxLines = 1, autoSize = TextAutoSize.StepBased(minFontSize = 14.sp, maxFontSize = style.fontSize),
        modifier = Modifier.semantics { contentDescription = "$label: ${spoken ?: value}" })
    below()
}

/** The colour of a chip's tone. */
@Composable
fun toneColor(t: Today.Tone): Color = when (t) {
    Today.Tone.POSITIVE -> semantic.successText
    Today.Tone.ATTENTION -> semantic.attentionText
    Today.Tone.ALERT -> semantic.alertText
    Today.Tone.INFO -> semantic.infoText
    Today.Tone.NEUTRAL -> semantic.textSecondary
}

/** A payment's state: a dot and a word on a raised pill. */
@Composable
fun StatusChip(status: String) {
    val (label, tone) = Today.status(status)
    val c = toneColor(tone)
    Row(Modifier.clip(RoundedCornerShape(Radius.Pill)).background(semantic.surfaceRaised).padding(horizontal = 10.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(c))
        Text(label, style = TypeScale.Caption.copy(fontWeight = TypeScale.Label.fontWeight), color = c)
    }
}

/** A payment method's chart colour (tokens: chart-*). */
@Composable
fun methodColor(method: String): Color = when (Today.chart(method)) {
    "credit" -> semantic.chartCredit
    "debit" -> semantic.chartDebit
    "pix" -> semantic.chartPix
    "crypto" -> semantic.chartCrypto
    else -> semantic.chartOther
}

/**
 * A sales chart (docs/06 §8): bars for the series it is about, a line for what it is compared
 * with, one y axis with clean ticks and a hairline grid. Tapping or dragging across it picks a
 * bucket, with a light tick, and the readout above shows every series there; TalkBack reads each
 * bucket as its own element, so no value is behind a gesture.
 */
@Composable
fun SalesChart(v: Today.SalesView, modifier: Modifier = Modifier) {
    val n = v.buckets.size
    val hasCompare = v.compare.size == n
    val unit = if (v.labels.firstOrNull()?.endsWith("h") == true) "hora" else "dia"
    var selected by remember(v) { mutableIntStateOf(-1) }
    val haptic = LocalHapticFeedback.current
    val select = { i: Int ->
        val k = i.coerceIn(0, n - 1)
        if (k != selected) {
            selected = k
            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        }
    }
    val measurer = rememberTextMeasurer()
    val focus = semantic.chartFocus
    val compareColor = semantic.chartCompare
    val grid = semantic.chartGrid
    val ink = semantic.textSecondary
    val tickStyle = TypeScale.Caption.copy(color = ink, fontFeatureSettings = "tnum")
    val density = LocalDensity.current
    val leftPx = with(density) { 56.dp.toPx() }
    val rightPx = with(density) { 4.dp.toPx() }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Space.Xs)) {
        // The legend: two series, a key for each; bars get a block, the line a short stroke.
        Row(horizontalArrangement = Arrangement.spacedBy(Space.Lg), verticalAlignment = Alignment.CenterVertically) {
            LegendKey(focus, line = false, label = v.focusName)
            if (hasCompare) LegendKey(compareColor, line = true, label = v.compareName)
        }
        // The readout: values lead, names follow.
        Box(Modifier.fillMaxWidth().heightIn(min = 40.dp).clearAndSetSemantics { }, contentAlignment = Alignment.CenterStart) {
            if (selected in 0 until n) {
                Column {
                    Text(v.spoken[selected], style = TypeScale.Caption, color = ink)
                    Row(horizontalArrangement = Arrangement.spacedBy(Space.Md), verticalAlignment = Alignment.CenterVertically) {
                        Text(Money(v.buckets[selected]).format(), style = TypeScale.Label.copy(fontFeatureSettings = "tnum"))
                        if (hasCompare) {
                            LegendKey(compareColor, line = true, label = "")
                            Text(Money(v.compare[selected]).format() + " " + v.compareName, style = TypeScale.Caption.copy(fontFeatureSettings = "tnum"), color = ink)
                        }
                    }
                }
            } else {
                Text("Toque ou arraste no gráfico para ver cada $unit", style = TypeScale.Caption, color = ink)
            }
        }
        Box(
            Modifier.fillMaxWidth().height(200.dp)
                .pointerInput(v) {
                    val slot = { x: Float -> ((x - leftPx) / ((size.width - leftPx - rightPx) / n)).toInt() }
                    detectTapGestures { o -> select(slot(o.x)) }
                }
                .pointerInput(v) {
                    val slot = { x: Float -> ((x - leftPx) / ((size.width - leftPx - rightPx) / n)).toInt() }
                    detectHorizontalDragGestures(onDragStart = { o -> select(slot(o.x)) }) { change, _ -> select(slot(change.position.x)) }
                },
        ) {
            Canvas(Modifier.fillMaxSize()) {
                val top = 8.dp.toPx()
                val bottom = 22.dp.toPx()
                val plotH = size.height - top - bottom
                val slot = (size.width - leftPx - rightPx) / n
                val bw = minOf(24.dp.toPx(), slot * 0.62f)
                val yMax = (v.ticks.lastOrNull() ?: 1L).coerceAtLeast(1L).toFloat()
                fun y(value: Long) = top + plotH - value / yMax * plotH
                fun cx(i: Int) = leftPx + i * slot + slot / 2
                for (t in v.ticks) {
                    drawLine(grid, Offset(leftPx, y(t)), Offset(size.width - rightPx, y(t)), strokeWidth = 1.dp.toPx())
                    val label = measurer.measure(Today.compact(t), tickStyle)
                    drawText(label, topLeft = Offset(leftPx - 6.dp.toPx() - label.size.width, y(t) - label.size.height / 2f))
                }
                v.buckets.forEachIndexed { i, value ->
                    if (value <= 0) return@forEachIndexed
                    val x0 = cx(i) - bw / 2
                    val y0 = minOf(y(value), y(0) - 1f)
                    val r = minOf(4.dp.toPx(), bw / 2, y(0) - y0)
                    val path = Path().apply {
                        addRoundRect(RoundRect(x0, y0, x0 + bw, y(0), topLeftCornerRadius = CornerRadius(r), topRightCornerRadius = CornerRadius(r),
                            bottomRightCornerRadius = CornerRadius.Zero, bottomLeftCornerRadius = CornerRadius.Zero))
                    }
                    drawPath(path, focus, alpha = if (selected >= 0 && selected != i) 0.55f else 1f)
                }
                if (hasCompare) {
                    val line = Path()
                    v.compare.forEachIndexed { i, c -> if (i == 0) line.moveTo(cx(i), y(c)) else line.lineTo(cx(i), y(c)) }
                    drawPath(line, compareColor, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                }
                if (selected in 0 until n) drawLine(ink, Offset(cx(selected), top), Offset(cx(selected), y(0)), strokeWidth = 1.dp.toPx())
                // As many x labels as fit side by side, the first and the last always.
                val gap = 48.dp.toPx()
                val shown = mutableListOf<Int>()
                for (i in v.axis) if (shown.isEmpty() || cx(i) - cx(shown.last()) >= gap) shown += i
                val last = v.axis.lastOrNull()
                if (last != null && shown.lastOrNull() != last) {
                    while (shown.size > 1 && cx(last) - cx(shown.last()) < gap) shown.removeAt(shown.lastIndex)
                    shown += last
                }
                for (i in shown) {
                    val label = measurer.measure(v.labels[i], tickStyle)
                    val x = (cx(i) - label.size.width / 2f).coerceIn(leftPx - 8.dp.toPx(), size.width - label.size.width.toFloat())
                    drawText(label, topLeft = Offset(x, size.height - bottom + 4.dp.toPx()))
                }
            }
            // One accessibility element per bucket, over its column: TalkBack reads every value.
            Row(Modifier.matchParentSize().padding(start = 56.dp, end = 4.dp)) {
                v.buckets.indices.forEach { i ->
                    val said = "${v.spoken[i]}: ${v.focusName} ${Money(v.buckets[i]).spoken()}" +
                        if (hasCompare) "; ${v.compareName} ${Money(v.compare[i]).spoken()}" else ""
                    Box(Modifier.weight(1f).fillMaxHeight().semantics {
                        contentDescription = said
                        onClick { select(i); true }
                    })
                }
            }
        }
    }
}

@Composable
private fun LegendKey(color: Color, line: Boolean, label: String) = Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
    Box(if (line) Modifier.width(16.dp).height(2.dp).clip(RoundedCornerShape(1.dp)).background(color) else Modifier.size(10.dp).clip(RoundedCornerShape(2.dp)).background(color))
    if (label.isNotEmpty()) Text(label, style = TypeScale.Caption, color = semantic.textSecondary)
}

/** How customers paid: a thin bar split by method in a fixed order, then the list that names them. */
@Composable
fun MethodMix(v: Today.SalesView, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Space.Sm)) {
        Row(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(Radius.Pill))
            .clearAndSetSemantics { contentDescription = v.byMethod.zip(v.shares).joinToString(", ") { (p, s) -> "${Today.method(p.method)} $s%" } },
            horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            v.byMethod.filter { it.gross > 0 }.forEach { p -> Box(Modifier.weight(p.gross.toFloat()).fillMaxHeight().background(methodColor(p.method))) }
        }
        v.byMethod.zip(v.shares).forEach { (p, s) ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.Sm)) {
                Box(Modifier.size(12.dp).clip(RoundedCornerShape(3.dp)).background(methodColor(p.method)))
                Text(Today.method(p.method), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                Text(Money(p.gross).format(), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"))
                Text("$s%", style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"), color = semantic.textSecondary,
                    modifier = Modifier.width(44.dp), textAlign = androidx.compose.ui.text.style.TextAlign.End)
            }
        }
    }
}

/** The period the sales card shows: one row of choices above everything it scopes. */
@Composable
fun PeriodPicker(selected: Int, onSelect: (Int) -> Unit) = Row(horizontalArrangement = Arrangement.spacedBy(Space.Sm)) {
    listOf(1 to "Hoje", 7 to "7 dias", 30 to "30 dias").forEach { (days, label) ->
        FilterChip(selected == days, { onSelect(days) }, label = { Text(label) }, modifier = Modifier.heightIn(min = Tokens.TouchMin))
    }
}

private val Brt = ZoneId.of("America/Sao_Paulo")
private val HourMinute = DateTimeFormatter.ofPattern("HH:mm")

/**
 * The sales card (docs/06 §6): what was sold and what the merchant keeps, against what it is
 * compared with, the shape of the period, how customers paid and what still waits. While the
 * next period loads the card stays, dimmed, so nothing jumps.
 */
@Composable
fun SalesCard(v: Today.SalesView, refreshing: Boolean = false) = SectionCard(Modifier.alpha(if (refreshing) 0.5f else 1f)) {
    CardHeader(v.title, v.range)
    Kpi("Vendido", Money(v.gross).format(), lead = true, spoken = Money(v.gross).spoken()) {
        val change = v.change
        if (change == null) {
            val where = when {
                v.compareName.endsWith("passado") -> "no"
                v.compareName.endsWith("passada") -> "na"
                else -> "nos"
            }
            Text("Sem vendas $where ${v.compareName} para comparar", style = TypeScale.Caption, color = semantic.textSecondary)
        } else {
            val c = when {
                v.changeSign > 0 -> semantic.successText
                v.changeSign < 0 -> semantic.alertText
                else -> semantic.textSecondary
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.Xs)) {
                if (v.changeSign != 0) Icon(if (v.changeSign > 0) AppIcons.Up else AppIcons.Down, null, tint = c, modifier = Modifier.size(16.dp))
                Text(change, style = TypeScale.Label.copy(fontFeatureSettings = "tnum"), color = c)
                Text(v.versus, style = TypeScale.Caption, color = semantic.textSecondary)
            }
        }
    }
    Row(Modifier.fillMaxWidth().padding(top = Space.Sm), horizontalArrangement = Arrangement.spacedBy(Space.Lg)) {
        Kpi("Você recebe", Money(v.net).format(), Modifier.weight(1.4f), color = semantic.successText, spoken = Money(v.net).spoken()) {
            Text(if (v.fees > 0) "${Money(v.fees).format()} de taxas" else "Sem taxas", style = TypeScale.Caption, color = semantic.textSecondary)
        }
        Kpi("Vendas", v.sales.toString(), Modifier.weight(0.8f))
        Kpi("Ticket médio", Money(v.averageTicket).format(), Modifier.weight(1.2f), spoken = Money(v.averageTicket).spoken())
    }
    if (v.sales > 0 || v.compare.any { it > 0 }) {
        Spacer(Modifier.height(Space.Sm))
        Overline(if (v.buckets.size == 24) "Por hora" else "Por dia")
        SalesChart(v)
    }
    if (v.sales > 0) {
        Spacer(Modifier.height(Space.Sm))
        Overline("Como pagaram")
        MethodMix(v)
    } else {
        Text(v.empty, style = MaterialTheme.typography.bodyMedium, color = semantic.textSecondary)
    }
    if (v.waitingCount > 0) {
        val label = if (v.waitingCount == 1L) "1 cobrança aguardando" else "${v.waitingCount} cobranças aguardando"
        Row(Modifier.fillMaxWidth().padding(top = Space.Sm).clip(RoundedCornerShape(Radius.Md)).background(semantic.surfaceRaised)
            .heightIn(min = Tokens.TouchMin).padding(horizontal = Space.Lg),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.Sm)) {
            Icon(AppIcons.Clock, null, tint = semantic.attentionText, modifier = Modifier.size(20.dp))
            Text(label, style = TypeScale.Label, modifier = Modifier.weight(1f))
            Text(Money(v.waitingAmount).format(), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"))
        }
    }
}

/** The day's latest payments with their state. */
@Composable
fun RecentSales(rows: List<RecentPayment>) = SectionCard {
    CardHeader("Últimas vendas")
    rows.forEachIndexed { i, p ->
        if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(semantic.border))
        Row(Modifier.fillMaxWidth().padding(vertical = Space.Xs), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.Md)) {
            Box(Modifier.size(36.dp).clip(CircleShape).background(semantic.surfaceRaised), contentAlignment = Alignment.Center) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(methodColor(p.method)))
            }
            Column(Modifier.weight(1f)) {
                Text(p.card ?: Today.method(p.method), style = TypeScale.Label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val at = runCatching { Instant.parse(p.createdAt).atZone(Brt).format(HourMinute) }.getOrDefault("")
                Text(listOfNotNull(at, if (p.card != null) Today.method(p.method) else null).joinToString(" · "), style = TypeScale.Caption, color = semantic.textSecondary)
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(Money(p.amount).format(), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"))
                StatusChip(p.status)
            }
        }
    }
}
