#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

/*
 Registers the Swift plugin with Capacitor's runtime.

 Not optional: Capacitor discovers plugins through the Objective-C runtime, so
 a Swift-only CAPPlugin subclass is invisible without this and
 `Capacitor.Plugins.WorkoutActivity` comes back undefined in JavaScript with no
 error anywhere. The name string is what `lib/native.ts` looks up.

 Add this file to the APP target.
 */
CAP_PLUGIN(WorkoutActivityPlugin, "WorkoutActivity",
    CAP_PLUGIN_METHOD(sync, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(end, CAPPluginReturnPromise);
)
