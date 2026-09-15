"""Configuration boundary for built-in interfaces in the pinned RNS 1.5.4.

LocalInterface belongs to RNS instance sharing, deliberately disabled here.
No interface source supplied by a contact, site, or config directory is loaded.
"""
BUILTIN_INTERFACES = frozenset({
    "AutoInterface", "BackboneInterface", "BackboneClientInterface",
    "TCPClientInterface", "TCPServerInterface", "UDPInterface",
    "SerialInterface", "KISSInterface", "AX25KISSInterface",
    "RNodeInterface", "RNodeMultiInterface", "WeaveInterface",
    "I2PInterface", "PipeInterface",
})


def validate_interfaces(settings):
    interfaces = settings.get("interfaces", {})
    if not isinstance(interfaces, dict) or len(interfaces) > 16:
        raise ValueError("at most 16 configured Reticulum interfaces are accepted")
    for section in interfaces.values():
        if not isinstance(section, dict) or section.get("type") not in BUILTIN_INTERFACES:
            raise ValueError("unsupported interface in dedicated config")
        if section["type"] == "PipeInterface":
            # Upstream executes the configured local program. Never enabled by
            # remote content or implicitly by accepting an invitation.
            policy = settings.get("relayloom", {})
            if not policy or "allow_pipe_interface" not in policy or not policy.as_bool("allow_pipe_interface"):
                raise ValueError("PipeInterface requires local allow_pipe_interface=Yes")


def interface_stats(interfaces):
    # No configured names, ports, device addresses, keys or discovery locations.
    return [{"type": type(i).__name__, "online": bool(getattr(i, "online", False)),
             "sent": int(i.txb), "received": int(i.rxb)} for i in list(interfaces)[:32]]
