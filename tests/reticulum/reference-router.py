"""Fixture: unmodified RNS transport only, no RelayLoom protocol or storage."""
import json
import sys
import RNS

rns = RNS.Reticulum(configdir=sys.argv[1], loglevel=RNS.LOG_ERROR,
                    logdest=lambda line: print(line, file=sys.stderr, flush=True))
assert RNS.Reticulum.transport_enabled()
print(json.dumps({"ready": True, "version": RNS.__version__}), flush=True)
for line in sys.stdin:
    if line.strip() == "stop":
        break
    print(json.dumps({"interfaces": [{"type": type(i).__name__, "name": str(i),
                                      "tx": i.txb, "rx": i.rxb}
                                     for i in RNS.Transport.interfaces]}), flush=True)
