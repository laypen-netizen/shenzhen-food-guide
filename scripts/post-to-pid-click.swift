#!/usr/bin/env swift
import AppKit
import CoreGraphics
import Foundation

struct Options {
    var windowID = 0
    var pid: pid_t = 0
    var x = 0.0
    var y = 0.0
    var execute = false
}

struct WindowInfo {
    let id: Int
    let pid: pid_t
    let bounds: CGRect
    let onscreen: Bool
}

func fail(_ message: String, code: Int32 = 2) -> Never {
    FileHandle.standardError.write(Data(("refused: \(message)\n").utf8))
    exit(code)
}

func usage() -> Never {
    print("Usage: scripts/post-to-pid-click.swift --window-id N --pid N --x N --y N [--execute]")
    print("Default: validate arguments and print the plan without sending input.")
    exit(1)
}

var options = Options()
var arguments = Array(CommandLine.arguments.dropFirst())
while !arguments.isEmpty {
    let key = arguments.removeFirst()
    switch key {
    case "--execute": options.execute = true
    case "--window-id": guard !arguments.isEmpty, let value=Int(arguments.removeFirst()) else { usage() }; options.windowID=value
    case "--pid": guard !arguments.isEmpty, let value=pid_t(arguments.removeFirst()) else { usage() }; options.pid=value
    case "--x": guard !arguments.isEmpty, let value=Double(arguments.removeFirst()) else { usage() }; options.x=value
    case "--y": guard !arguments.isEmpty, let value=Double(arguments.removeFirst()) else { usage() }; options.y=value
    case "--help", "-h": usage()
    default: usage()
    }
}

guard options.windowID > 0, options.pid > 0 else { usage() }
print("postToPid click plan window=\(options.windowID) pid=\(options.pid) point=(\(Int(options.x)),\(Int(options.y)))")
guard options.execute else {
    print("plan-only: no pointer or mouse event was sent")
    exit(0)
}

let raw=(CGWindowListCopyWindowInfo([.optionAll,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]]) ?? []
let windows:[WindowInfo]=raw.map { item in
    let box=item[kCGWindowBounds as String] as? [String:Any] ?? [:]
    return WindowInfo(
        id:item[kCGWindowNumber as String] as? Int ?? 0,
        pid:pid_t(item[kCGWindowOwnerPID as String] as? Int ?? 0),
        bounds:CGRect(
            x:box["X"] as? Double ?? 0,
            y:box["Y"] as? Double ?? 0,
            width:box["Width"] as? Double ?? 0,
            height:box["Height"] as? Double ?? 0
        ),
        onscreen:item[kCGWindowIsOnscreen as String] as? Bool ?? false
    )
}

guard let target=windows.first(where:{$0.id==options.windowID}) else { fail("target window no longer exists") }
guard target.pid==options.pid else { fail("target window PID changed from \(options.pid) to \(target.pid)") }
guard target.onscreen else { fail("target window is not on the current Space") }
let point=CGPoint(x:options.x,y:options.y)
guard target.bounds.contains(point) else { fail("click point is outside target window bounds") }
guard NSWorkspace.shared.frontmostApplication?.processIdentifier==options.pid else { fail("target PID is not frontmost") }
guard let source=CGEventSource(stateID:.privateState) else { fail("could not create event source",code:1) }
guard let down=CGEvent(mouseEventSource:source,mouseType:.leftMouseDown,mouseCursorPosition:point,mouseButton:.left),
      let up=CGEvent(mouseEventSource:source,mouseType:.leftMouseUp,mouseCursorPosition:point,mouseButton:.left)
else { fail("could not create click events",code:1) }
down.location=point
up.location=point
down.postToPid(options.pid)
usleep(80_000)
up.postToPid(options.pid)
print("posted background click to target PID; success still requires screenshot and OCR confirmation")
