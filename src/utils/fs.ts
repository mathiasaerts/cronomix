import * as Gio from 'imports.gi.Gio';
import * as GLib from 'imports.gi.GLib';

import { _ } from 'utils/misc';

export function decode_bytes (arr: unknown): string {
    const decoder = new TextDecoder();
    return decoder.decode(arr);
}

export function file_new_for_path (path: string): Gio.File {
    if (path[0] === '~') path = GLib.get_home_dir() + path.slice(1);
    return Gio.File.new_for_path(path);
}

export function create_dir (path: string): Gio.File | null {
    const dir = file_new_for_path(path);
    if (! create_dir_path(dir)) return null;
    return dir;
}

export function create_file (path: string): Gio.File | null {
    const file = file_new_for_path(path);

    if (! create_dir_path(file.get_parent())) return null;

    try {
        file.create(Gio.FileCreateFlags.NONE, null);
    } catch (e) {
        if (check_gio_error(e, [Gio.IOErrorEnum.EXISTS])) return null;
    }

    return file;
}

export function read_entire_file (path: string): string | null {
    const file = file_new_for_path(path);

    try {
        const [ok, bytes] = file.load_contents(null);
        return ok ? decode_bytes(bytes) : null;
    } catch (e) {
        return null;
    }
}

export function write_entire_file (path: string, content: string): boolean {
    const file = create_file(path);
    if (! file) return false;

    try {
        const [ok] = file.replace_contents(content, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        return ok;
    } catch (e) {
        logError(e);
        return false;
    }
}

export function append_to_file (path: string, content: string): boolean {
    const file = create_file(path);
    if (! file) return false;

    try {
        const append_stream = file.append_to(Gio.FileCreateFlags.NONE, null);
        if (! append_stream) return false;
        append_stream.write_all(content, null);
        return true;
    } catch (e) {
        logError(e);
        return false;
    }
}

export function open_web_uri_in_default_app (uri: string): boolean {
    uri = uri.trim();
    if (uri.indexOf(':') === -1) uri = 'https://' + uri;

    try {
        return Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (e) {
        logError(e);
        return false;
    }
}

export function open_file_in_default_app (path: string) {
    path = path.replace(/\\ /g, ' ').trim();
    if (path[0] === '~') path = GLib.get_home_dir() + path.slice(1);

    try {
        const ctx: Gio.AppLaunchContext = global.create_app_launch_context(0, -1);
        Gio.AppInfo.launch_default_for_uri(GLib.filename_to_uri(path, null), ctx);
    } catch (e) {
        logError(e);
    }
}

export function open_file_dialog (
    select_dirs: boolean,
    start: string|null,
    callback: (result: string) => void
): Gio.Subprocess | null {
    try {
        start ??= GLib.get_home_dir() + '/';
        const argv = ['zenity', '--file-selection', (select_dirs ? '--directory' : ''), `--filename=${start}`];
        const sp   = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE);

        sp?.wait_check_async(null, (_, result) => {
            try {
                sp.wait_check_finish(result);
                const stream = Gio.DataInputStream.new(sp.get_stdout_pipe());
                const [out] = stream.read_line_utf8(null);
                callback(out);
                stream.close(null);
            } catch {}
        });

        return sp;
    } catch { return null; }
}

export class FileMonitor {
    is_closed = true;

    #sid!: number;
    #monitor: Gio.FileMonitor|null = null;

    constructor (path: string, on_change: () => void) {
        try {
            const file = file_new_for_path(path);
            if (! file) return;

            this.#monitor = file.monitor(Gio.FileMonitorFlags.NONE, null);
            if (! this.#monitor) return;

            this.#sid = this.#monitor.connect('changed', (...args: unknown[]) => {
                const e = args[3];
                if (e === Gio.FileMonitorEvent.CHANGES_DONE_HINT) on_change();
            });

            this.is_closed = false;
        } catch (e) { logError(e); }
    }

    destroy () {
        if (this.#monitor) {
            this.#monitor.disconnect(this.#sid);
            this.#monitor.cancel();
            this.#monitor = null;
            this.is_closed = true;
        }
    }
}

function create_dir_path (dir: Gio.File | null): boolean {
    if (! dir) return false;

    try {
        dir.make_directory_with_parents(null);
    } catch (e) {
        if (check_gio_error(e, [Gio.IOErrorEnum.EXISTS])) return false;
    }

    return true;
}

function check_gio_error (error: unknown, codes_to_ignore: Gio.IOErrorEnum[]): boolean {
    if (! (error instanceof GLib.Error)) return true;
    for (const code of codes_to_ignore) if (error.matches(Gio.IOErrorEnum, code)) return false;
    logError(error);
    return true;
}
