# Entry point so `nix-build packaging/nix` works from a repo checkout. The
# expression needs the repo's own icon files (see onedesk.nix).
{ pkgs ? import <nixpkgs> { } }:
pkgs.callPackage ./onedesk.nix { }
