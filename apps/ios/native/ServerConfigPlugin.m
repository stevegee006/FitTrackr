#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

/*
 Registers the Swift plugin with Capacitor's runtime.

 Not optional: Capacitor discovers plugins through the Objective-C runtime, so
 a Swift-only CAPPlugin subclass is invisible without this and
 `Capacitor.Plugins.ServerConfig` comes back undefined in JavaScript with no
 error anywhere. The name string is what `lib/native.ts` looks up.

 Add this file to the APP target.
 */
CAP_PLUGIN(ServerConfigPlugin, "ServerConfig",
    CAP_PLUGIN_METHOD(get, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(set, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(reset, CAPPluginReturnPromise);
)
