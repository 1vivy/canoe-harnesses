#!/usr/bin/env python3
"""A polkit authentication agent that refuses everything.

pkexec exits 126 when the agent reports the operator dismissed the prompt, which
is exactly the "elevation-cancelled" path the app classifies. Registering a real
agent (rather than leaving none) is what separates this from the
"agent-unavailable" case, which exits 127.
"""
import dbus
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

BUS_NAME = "org.freedesktop.PolicyKit1.AuthenticationAgent"
OBJECT_PATH = "/org/freedesktop/PolicyKit1/AuthenticationAgent"


class DenyAgent(dbus.service.Object):
    @dbus.service.method(BUS_NAME, in_signature="sssa{ss}sa(sa{sv})", out_signature="")
    def BeginAuthentication(self, action_id, message, icon_name, details, cookie, identities):
        raise dbus.DBusException("Dismissed by the harness", name="org.freedesktop.PolicyKit1.Error.Cancelled")

    @dbus.service.method(BUS_NAME, in_signature="s", out_signature="")
    def CancelAuthentication(self, cookie):
        return None


def main():
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()
    agent = DenyAgent(bus, OBJECT_PATH)
    authority = dbus.Interface(
        bus.get_object("org.freedesktop.PolicyKit1", "/org/freedesktop/PolicyKit1/Authority"),
        "org.freedesktop.PolicyKit1.Authority",
    )
    import os
    import sys
    pid = int(sys.argv[1])
    # Register against the actual app process, not an unrelated SSH/audit session.
    with open(f"/proc/{pid}/stat") as handle:
        fields = handle.read().rsplit(")", 1)[1].split()
    subject = ("unix-process", {
        "pid": dbus.UInt32(pid, variant_level=1),
        "start-time": dbus.UInt64(int(fields[19]), variant_level=1),
        "uid": dbus.Int32(os.getuid(), variant_level=1),
    })
    authority.RegisterAuthenticationAgent(subject, "en_US.UTF-8", OBJECT_PATH)
    print("deny agent registered", flush=True)
    GLib.MainLoop().run()


if __name__ == "__main__":
    main()
