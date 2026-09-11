#import <Foundation/Foundation.h>

// C wrappers avoid relying on Swift's automatic NSError importer for generated
// gomobile C functions. Error text remains local and never includes capability.
FOUNDATION_EXPORT NSDictionary<NSString *, NSString *> * _Nonnull RLStartCore(NSString * _Nonnull data, NSString * _Nonnull assets);
FOUNDATION_EXPORT BOOL RLStopCore(void);
FOUNDATION_EXPORT NSString * _Nonnull RLCoreVersion(void);
