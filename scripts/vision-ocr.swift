#!/usr/bin/env swift
import AppKit
import Foundation
import Vision

struct OCRLine: Encodable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct OCRDocument: Encodable {
    let file: String
    let pixelWidth: Int
    let pixelHeight: Int
    let lines: [OCRLine]
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let paths = Array(CommandLine.arguments.dropFirst())
if paths.isEmpty { fail("Usage: scripts/vision-ocr.swift <image> [image ...]") }
let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]

for path in paths {
    let url = URL(fileURLWithPath: path)
    guard let image = NSImage(contentsOf: url),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
    else { fail("Cannot read image: \(path)") }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])

    let lines = (request.results ?? []).compactMap { observation -> OCRLine? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return OCRLine(
            text: candidate.string,
            confidence: candidate.confidence,
            x: box.origin.x,
            y: 1.0 - box.origin.y - box.height,
            width: box.width,
            height: box.height
        )
    }.sorted { lhs, rhs in
        abs(lhs.y - rhs.y) > 0.015 ? lhs.y < rhs.y : lhs.x < rhs.x
    }

    let document = OCRDocument(file: path, pixelWidth: cgImage.width, pixelHeight: cgImage.height, lines: lines)
    guard let data = try? encoder.encode(document), let json = String(data: data, encoding: .utf8) else {
        fail("Cannot encode OCR result: \(path)")
    }
    print(json)
}
