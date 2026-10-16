// The picture's own window: a script for macOS's `osascript -l JavaScript`,
// given the file, a title and the picture's size in pixels. It shows the file
// in a small panel that floats over the terminal, a full-screen one too, and
// leaves the keyboard with the terminal. Closing the panel ends the script.
//
// Quick Look's own window (`qlmanage -p`) opens behind a terminal that fills
// the screen, where nobody sees it, which is why Peek brings a panel of its own.
export const WINDOW = `
ObjC.import('Cocoa')

function run(argv) {
  var file = argv[0]
  var title = argv[1] || 'Image'
  var width = Number(argv[2]) || 800
  var height = Number(argv[3]) || 600
  var app = $.NSApplication.sharedApplication
  // a background process: no Dock icon, and it never takes the keyboard
  app.setActivationPolicy($.NSApplicationActivationPolicyProhibited)

  // the screen the pointer is on, which is where the click on Open came from
  var mouse = $.NSEvent.mouseLocation
  var screens = $.NSScreen.screens
  var screen = $.NSScreen.mainScreen
  for (var i = 0; i < screens.count; i++) {
    var f = screens.objectAtIndex(i).frame
    if (mouse.x >= f.origin.x && mouse.x < f.origin.x + f.size.width && mouse.y >= f.origin.y && mouse.y < f.origin.y + f.size.height) {
      screen = screens.objectAtIndex(i)
    }
  }
  // the picture at its own size, shrunk where it would not fit in four fifths of the screen
  var room = screen.visibleFrame
  var scale = Math.min(1, (room.size.width * 0.8) / width, (room.size.height * 0.8) / height)
  var w = Math.max(320, Math.round(width * scale))
  var h = Math.max(200, Math.round(height * scale))
  var frame = $.NSMakeRect(room.origin.x + (room.size.width - w) / 2, room.origin.y + (room.size.height - h) / 2, w, h)

  // a panel with a title bar and a close button (1 | 2), resizable (8), that leaves the keyboard alone (128)
  var panel = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer(frame, 1 | 2 | 8 | 128, $.NSBackingStoreBuffered, false)
  panel.title = title
  panel.releasedWhenClosed = false
  // a panel hides while its app is not the active one, and this one never is
  panel.hidesOnDeactivate = false
  // floating (3), on every Space (1) and allowed beside a full-screen window (256)
  panel.level = 3
  panel.collectionBehavior = 1 | 256
  var view = $.NSImageView.alloc.initWithFrame($.NSMakeRect(0, 0, w, h))
  view.image = $.NSImage.alloc.initWithContentsOfFile(file)
  // fitted to the panel, keeping the picture's shape
  view.imageScaling = 3
  view.animates = true
  panel.contentView = view

  // closing the panel ends the script
  ObjC.registerSubclass({
    name: 'PeekWindowDelegate',
    methods: {
      'windowWillClose:': {
        types: ['void', ['id']],
        implementation: function () {
          $.NSApplication.sharedApplication.terminate(null)
        },
      },
    },
  })
  var delegate = $.PeekWindowDelegate.alloc.init
  panel.delegate = delegate
  panel.orderFrontRegardless
  app.run
}
`
