import WidgetKit
import SwiftUI

/**
 The rest countdown as a watch face complication.

 Reads the same App Group store the watch app writes and reads, so the face and
 the app can never disagree about whether rest is running — the alternative,
 each process keeping its own copy, is a bug that only shows up as two
 different numbers on two screens a second apart.

 Nothing here ticks. `ProgressView(timerInterval:)` and
 `Text(timerInterval:)` animate themselves once rendered, which is the only way
 a per-second countdown is possible at all: WidgetKit will not wake an
 extension every second, and a timeline of 90 one-second entries would blow the
 refresh budget on a single rest.

 The timeline therefore holds ONE entry and a reload policy set to the moment
 rest ends, so the complication clears itself and asks for nothing in between.

 Add this file, plus `SharedRest.swift`, to the COMPLICATION target.
 */

// MARK: - Timeline

struct RestEntry: TimelineEntry {
    let date: Date
    let rest: RestState?
}

struct RestProvider: TimelineProvider {
    func placeholder(in context: Context) -> RestEntry {
        RestEntry(date: .now, rest: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (RestEntry) -> Void) {
        completion(RestEntry(date: .now, rest: SharedRest.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RestEntry>) -> Void) {
        // `SharedRest.read()` already returns nil for a rest that has elapsed,
        // so a complication woken late shows nothing rather than a countdown
        // that finished while the extension was asleep.
        let rest = SharedRest.read()

        // One entry. `.after(endsAt)` is what makes it clear itself; `.never`
        // when idle, because the watch app calls
        // `WidgetCenter.reloadAllTimelines()` the moment rest starts — it is
        // already awake, holding the workout session, so there is nothing to
        // poll for.
        let policy: TimelineReloadPolicy = rest
            .map { .after($0.endsAt.addingTimeInterval(1)) } ?? .never

        completion(Timeline(entries: [RestEntry(date: .now, rest: rest)], policy: policy))
    }
}

// MARK: - Views

private struct RestComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: RestEntry

    var body: some View {
        switch family {
        case .accessoryCircular: circular
        case .accessoryCorner: corner
        case .accessoryInline: inline
        default: rectangular
        }
    }

    /// A ring that drains as the rest runs down — the most glanceable form, and
    /// the reason to prefer `ProgressView(timerInterval:)` over a static value.
    private var circular: some View {
        Group {
            if let rest = entry.rest {
                ProgressView(timerInterval: rest.endsAt.addingTimeInterval(-restSpan(rest))...rest.endsAt,
                             countsDown: true) {
                    Image(systemName: "timer")
                } currentValueLabel: {
                    Text(timerInterval: Date()...rest.endsAt, countsDown: true)
                        .monospacedDigit()
                        .minimumScaleFactor(0.5)
                }
                .progressViewStyle(.circular)
            } else {
                // Idle: the app glyph, so tapping the complication still opens
                // FitTrackr. A blank complication reads as broken.
                Image(systemName: "figure.strengthtraining.traditional")
                    .foregroundStyle(.tint)
            }
        }
        .containerBackground(.clear, for: .widget)
    }

    private var corner: some View {
        Group {
            if let rest = entry.rest {
                Text(timerInterval: Date()...rest.endsAt, countsDown: true)
                    .monospacedDigit()
            } else {
                Image(systemName: "figure.strengthtraining.traditional")
            }
        }
        .containerBackground(.clear, for: .widget)
    }

    private var inline: some View {
        Group {
            if let rest = entry.rest {
                // The exercise name is worth the width here: an inline
                // complication is a whole line of the face, and "Rest 0:42" on
                // its own does not say rest from what.
                if let name = rest.exerciseName {
                    Text("\(name) · \(Text(timerInterval: Date()...rest.endsAt, countsDown: true))")
                } else {
                    Text("Rest \(Text(timerInterval: Date()...rest.endsAt, countsDown: true))")
                }
            } else {
                Text("FitTrackr")
            }
        }
        .containerBackground(.clear, for: .widget)
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let rest = entry.rest {
                Text("REST")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.teal)

                Text(timerInterval: Date()...rest.endsAt, countsDown: true)
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)

                if let set = rest.setNumber, let total = rest.totalSets {
                    Text("Set \(set) of \(total)")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                } else if let name = rest.exerciseName {
                    Text(name)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            } else {
                Text("FitTrackr")
                    .font(.system(size: 13, weight: .semibold))
                Text("No rest running")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
        .containerBackground(.clear, for: .widget)
    }

    /**
     How long this rest was in total, for the ring to drain across.

     Not stored, and deliberately not: the phone sends only the end instant,
     because that is the one value that stays true regardless of when the
     message arrives (see `SharedRest`). The ring needs a span, so it is
     inferred from what remains, clamped to something sane — a ring that is
     roughly right beats another field that can arrive stale.
     */
    private func restSpan(_ rest: RestState) -> TimeInterval {
        max(30, min(600, rest.endsAt.timeIntervalSinceNow))
    }
}

// MARK: - Widget

struct RestComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FitTrackrRest", provider: RestProvider()) { entry in
            RestComplicationView(entry: entry)
        }
        .configurationDisplayName("Rest Timer")
        .description("The countdown between sets.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryCorner,
            .accessoryInline,
            .accessoryRectangular,
        ])
    }
}

@main
struct FitTrackrComplicationBundle: WidgetBundle {
    var body: some Widget {
        RestComplication()
    }
}
