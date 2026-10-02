#!/usr/bin/env swift
import AppKit
import CoreGraphics
import Foundation

struct Options {
    var windowID: Int = 0
    var pid: pid_t = 0
    var x: Double = 0
    var y: Double = 0
    var distance: Int = -420
    var steps: Int = 8
    var mode = "wheel"
    var background = false
    var execute = false
}

struct WindowInfo {
    let id: Int
    let pid: pid_t
    let owner: String
    let bounds: CGRect
    let layer: Int
    let onscreen: Bool
}

func fail(_ message: String, code: Int32 = 2) -> Never {
    FileHandle.standardError.write(Data(("refused: " + message + "\n").utf8))
    exit(code)
}

func usage() -> Never {
    print("""
    Usage:
      scripts/continuous-scroll.swift --window-id N --pid N --x N --y N \
        --distance -420 --steps 8 [--mode wheel|drag|click] [--background] [--execute]

    Default: print the phased continuous-scroll plan without sending input.
    wheel emits Began/Changed/Ended pixel-wheel events. drag emits a real
    leftMouseDown/leftMouseDragged/leftMouseUp gesture from (x,y) to
    (x,y+distance).
    --background is wheel-only: it posts each event directly to the target PID,
    does not move the real pointer, and does not require the app to be frontmost.
    --execute refuses unless the target PID is frontmost, the exact window is
    onscreen and topmost at the point, and keyboard/mouse idle time is >=2s.
    """)
    exit(1)
}

var options = Options()
var args = Array(CommandLine.arguments.dropFirst())
while !args.isEmpty {
    let key = args.removeFirst()
    switch key {
    case "--execute": options.execute = true
    case "--background": options.background = true
    case "--window-id": guard !args.isEmpty, let value=Int(args.removeFirst()) else { usage() }; options.windowID=value
    case "--pid": guard !args.isEmpty, let value=pid_t(args.removeFirst()) else { usage() }; options.pid=value
    case "--x": guard !args.isEmpty, let value=Double(args.removeFirst()) else { usage() }; options.x=value
    case "--y": guard !args.isEmpty, let value=Double(args.removeFirst()) else { usage() }; options.y=value
    case "--distance": guard !args.isEmpty, let value=Int(args.removeFirst()) else { usage() }; options.distance=value
    case "--steps": guard !args.isEmpty, let value=Int(args.removeFirst()) else { usage() }; options.steps=value
    case "--mode": guard !args.isEmpty else { usage() }; options.mode=args.removeFirst()
    case "--help", "-h": usage()
    default: usage()
    }
}

guard options.windowID > 0, options.pid > 0 else { usage() }
guard options.steps >= 3 && options.steps <= 20 else { fail("steps must be 3...20") }
guard options.distance != 0 && abs(options.distance) <= 1200 else { fail("distance must be nonzero and <=1200 pixels") }
guard ["wheel","drag","click"].contains(options.mode) else { fail("mode must be wheel, drag, or click") }
guard !(options.background && options.mode != "wheel") else { fail("background mode supports wheel only") }
if options.mode == "drag" && abs(options.distance) < 80 { fail("drag distance must be at least 80 pixels") }

func windows() -> [WindowInfo] {
    let raw=(CGWindowListCopyWindowInfo([.optionAll,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]]) ?? []
    return raw.map { item in
        let box=item[kCGWindowBounds as String] as? [String:Any] ?? [:]
        return WindowInfo(
            id:item[kCGWindowNumber as String] as? Int ?? 0,
            pid:pid_t(item[kCGWindowOwnerPID as String] as? Int ?? 0),
            owner:item[kCGWindowOwnerName as String] as? String ?? "?",
            bounds:CGRect(
                x:box["X"] as? Double ?? 0,
                y:box["Y"] as? Double ?? 0,
                width:box["Width"] as? Double ?? 0,
                height:box["Height"] as? Double ?? 0
            ),
            layer:item[kCGWindowLayer as String] as? Int ?? 0,
            onscreen:item[kCGWindowIsOnscreen as String] as? Bool ?? false
        )
    }
}

func idleSeconds() -> Double {
    let eventTypes:[CGEventType] = [.keyDown,.leftMouseDown,.rightMouseDown,.otherMouseDown,.mouseMoved,.scrollWheel]
    return eventTypes.map { CGEventSource.secondsSinceLastEventType(.hidSystemState,eventType:$0) }.min() ?? 0
}

func deltas(total:Int,count:Int) -> [Int32] {
    let weights=(0..<count).map { sin(Double($0 + 1) * .pi / Double(count + 1)) }
    let sum=weights.reduce(0,+)
    var result=weights.map { Int32((Double(total) * $0 / sum).rounded()) }
    let correction=Int32(total)-result.reduce(0,+)
    result[result.count-1] += correction
    return result
}

let changes=deltas(total:options.distance,count:options.steps)
let plan=["began:\(changes[0])"] + changes.dropFirst().map { "changed:\($0)" } + ["ended:0"]
print("continuous-scroll plan mode=\(options.mode) delivery=\(options.background ? "postToPid" : "global-HID") window=\(options.windowID) pid=\(options.pid) point=(\(Int(options.x)),\(Int(options.y))) total=\(options.distance) steps=\(options.steps)")
if options.mode == "wheel" {
    print(plan.joined(separator:" "))
} else if options.mode == "drag" {
    print("drag: (\(Int(options.x)),\(Int(options.y))) -> (\(Int(options.x)),\(Int(options.y) + options.distance)) in \(options.steps) eased moves")
} else {
    print("click: pointer move, mouse down, mouse up at target, then restore pointer")
}
guard options.execute else {
    print("plan-only: no pointer or scroll event was sent")
    exit(0)
}

let point=CGPoint(x:options.x,y:options.y)
let currentWindows=windows()
guard let target=currentWindows.first(where:{$0.id==options.windowID}) else { fail("target window no longer exists") }
guard target.pid==options.pid else { fail("target window PID changed from \(options.pid) to \(target.pid)") }
guard target.onscreen else { fail("target window is not on the current Space") }
guard target.bounds.contains(point) else { fail("scroll point is outside target window bounds") }
let endPoint=CGPoint(x:point.x,y:point.y + Double(options.distance))
if options.mode == "drag" {
    let safeBounds=target.bounds.insetBy(dx:12,dy:12)
    guard safeBounds.contains(point) && safeBounds.contains(endPoint) else { fail("drag start or end is outside the target window safe bounds") }
}
if !options.background {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier==options.pid else { fail("target PID is not frontmost") }
    guard let top=currentWindows.first(where:{$0.onscreen && $0.layer==0 && $0.bounds.contains(point)}), top.id==options.windowID else {
        fail("target window is obscured at scroll point")
    }
    let idle=idleSeconds()
    guard idle>=2 else { fail(String(format:"user input was seen %.2fs ago",idle)) }
}

guard let source=CGEventSource(stateID:options.background ? .privateState : .hidSystemState) else { fail("could not create event source",code:1) }
let savedMouse=options.background ? nil : CGEvent(source:nil)?.location
if !options.background {
    CGEvent(mouseEventSource:source,mouseType:.mouseMoved,mouseCursorPosition:point,mouseButton:.left)?.post(tap:.cghidEventTap)
    usleep(120_000)
}

func post(delta:Int32,phase:CGScrollPhase) {
    guard let event=CGEvent(scrollWheelEvent2Source:source,units:.pixel,wheelCount:2,wheel1:delta,wheel2:0,wheel3:0) else { return }
    event.location=point
    event.setIntegerValueField(.scrollWheelEventIsContinuous,value:1)
    event.setIntegerValueField(.scrollWheelEventScrollCount,value:1)
    event.setIntegerValueField(.scrollWheelEventScrollPhase,value:Int64(phase.rawValue))
    event.setIntegerValueField(.scrollWheelEventMomentumPhase,value:Int64(CGMomentumScrollPhase.none.rawValue))
    if options.background {
        event.postToPid(options.pid)
    } else {
        event.post(tap:.cghidEventTap)
    }
    usleep(16_667)
}

if options.mode == "wheel" {
    post(delta:changes[0],phase:.began)
    for delta in changes.dropFirst() { post(delta:delta,phase:.changed) }
    post(delta:0,phase:.ended)
} else if options.mode == "click" {
    guard let down=CGEvent(mouseEventSource:source,mouseType:.leftMouseDown,mouseCursorPosition:point,mouseButton:.left),
          let up=CGEvent(mouseEventSource:source,mouseType:.leftMouseUp,mouseCursorPosition:point,mouseButton:.left) else { fail("could not create click events",code:1) }
    down.post(tap:.cghidEventTap)
    usleep(100_000)
    up.post(tap:.cghidEventTap)
} else {
    guard let down=CGEvent(mouseEventSource:source,mouseType:.leftMouseDown,mouseCursorPosition:point,mouseButton:.left) else { fail("could not create mouse-down event",code:1) }
    let dragEvents:[CGEvent] = (1...options.steps).map { index in
        let t=Double(index)/Double(options.steps)
        let eased=t*t*(3 - 2*t)
        let next=CGPoint(x:point.x,y:point.y + Double(options.distance)*eased)
        guard let drag=CGEvent(mouseEventSource:source,mouseType:.leftMouseDragged,mouseCursorPosition:next,mouseButton:.left) else { fail("could not create mouse-drag event",code:1) }
        return drag
    }
    guard let up=CGEvent(mouseEventSource:source,mouseType:.leftMouseUp,mouseCursorPosition:endPoint,mouseButton:.left) else { fail("could not create mouse-up event",code:1) }
    down.post(tap:.cghidEventTap)
    usleep(80_000)
    for drag in dragEvents {
        drag.post(tap:.cghidEventTap)
        usleep(16_667)
    }
    up.post(tap:.cghidEventTap)
}
usleep(100_000)
if let savedMouse {
    CGEvent(mouseEventSource:source,mouseType:.mouseMoved,mouseCursorPosition:savedMouse,mouseButton:.left)?.post(tap:.cghidEventTap)
}
print("posted \(options.mode) via \(options.background ? "postToPid" : "global HID"); success still requires before/after screenshot and OCR confirmation")
