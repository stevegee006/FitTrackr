#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

/*
 Registers the Swift plugin with Capacitor's runtime.

 This file is not optional and not decorative: Capacitor discovers plugins
 through the Objective-C runtime, so a Swift-only CAPPlugin subclass is
 invisible without it and `Capacitor.Plugins.RestTimer` comes back undefined in
 JavaScript with no error anywhere. The name string here is what the web side
 looks up in `lib/native.ts`.

 Add this file to the APP target.
 */
CAP_PLUGIN(RestTimerPlugin, "RestTimer",
    CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(update, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(end, CAPPluginReturnPromise);
)
