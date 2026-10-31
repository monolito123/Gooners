import AVFoundation
import GoonersPayKit

/// Plays the tones of a sale (docs/06 §7), synthesized by the kit. They follow the silent
/// switch (the ambient category, mixed with other audio), except the approval tone when the
/// merchant turned "Som de aprovação sempre ligado" on: a busy counter often needs it, so it
/// then plays in the playback category, which the switch does not silence.
@MainActor
final class Sounds {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
    private var buffers: [Tone: AVAudioPCMBuffer] = [:]

    init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
    }

    func play(_ tone: Tone, ignoringSilentSwitch: Bool = false) {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(ignoringSilentSwitch ? .playback : .ambient, options: [.mixWithOthers])
            try session.setActive(true)
            if !engine.isRunning { try engine.start() }
        } catch {
            return // sound is a courtesy: the screen and the haptic still say what happened
        }
        guard let buffer = buffer(tone) else { return }
        player.scheduleBuffer(buffer, at: nil, options: .interrupts)
        if !player.isPlaying { player.play() }
    }

    private func buffer(_ tone: Tone) -> AVAudioPCMBuffer? {
        if let b = buffers[tone] { return b }
        let samples = tone.samples(sampleRate: format.sampleRate)
        guard let b = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)), let channel = b.floatChannelData else { return nil }
        b.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { src in
            if let base = src.baseAddress { channel[0].update(from: base, count: samples.count) }
        }
        buffers[tone] = b
        return b
    }
}
