#import "NativeBridge.h"
#import <Mobile/Mobile.h>

NSDictionary<NSString *, NSString *> *RLStartCore(NSString *data, NSString *assets) {
    NSError *error = nil;
    NSString *response = MobileStart(data, assets, &error);
    if (error != nil || response == nil) return @{ @"error": @"Native core startup failed" };
    return @{ @"response": response };
}

BOOL RLStopCore(void) {
    NSError *error = nil;
    return MobileStop(&error) && error == nil;
}

NSString *RLCoreVersion(void) { return MobileVersion(); }
