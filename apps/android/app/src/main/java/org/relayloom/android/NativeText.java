package org.relayloom.android;

import android.content.Context;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import android.util.JsonReader;
import android.util.JsonToken;
import java.io.File;
import java.io.FileDescriptor;
import java.io.StringReader;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Read-only presentation hints. Never opens the vault or modifies the profile. */
final class NativeText {
    static String text(Context context, String source) {
        List<String> preferred = new ArrayList<>();
        android.os.LocaleList locales = context.getResources().getConfiguration().getLocales();
        for (int i = 0; i < locales.size(); i++) preferred.add(locales.get(i).toLanguageTag());
        return translate(language(new File(context.getFilesDir(), "core"), preferred), source);
    }

    static String fallback(List<String> preferred) {
        for (String tag : preferred) {
            String base = tag.toLowerCase(Locale.ROOT).replace('_', '-').split("-", 2)[0];
            if (base.equals("pt")) return "pt-PT";
            if (base.equals("en")) return "en-GB";
            if (base.equals("es")) return "es-ES";
        }
        return "pt-PT";
    }

    static String language(File core, List<String> preferred) {
        String fallback = fallback(preferred);
        try {
            // Android itself aliases /data/user/0. Resolve that trusted app parent,
            // then require the actual core entry to be a directory, not a symlink.
            File directory = new File(core.getParentFile().getCanonicalFile(), core.getName());
            if (!OsConstants.S_ISDIR(Os.lstat(directory.getPath()).st_mode)) return fallback;
            File path = new File(directory, "ui-preferences.json");
            FileDescriptor fd = Os.open(path.getPath(), OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW | OsConstants.O_NONBLOCK | OsConstants.O_CLOEXEC, 0);
            byte[] bytes = new byte[4097]; int count = 0;
            try {
                StructStat stat = Os.fstat(fd);
                if (!OsConstants.S_ISREG(stat.st_mode) || stat.st_size > 4096) return fallback;
                while (count < bytes.length) {
                    int read = Os.read(fd, bytes, count, bytes.length - count);
                    if (read == 0) break;
                    count += read;
                }
            } finally { Os.close(fd); }
            if (count == 0 || count > 4096) return fallback;
            String json = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes, 0, count)).toString();
            String saved = parse(json);
            return saved == null ? fallback : saved;
        } catch (Exception ignored) { return fallback; }
    }

    private static String parse(String json) throws Exception {
        try (JsonReader reader = new JsonReader(new StringReader(json))) {
            reader.setLenient(false); reader.beginObject();
            Set<String> keys = new HashSet<>(); String language = null;
            while (reader.hasNext()) {
                String key = reader.nextName(); if (!keys.add(key)) throw new IllegalArgumentException();
                if (key.equals("version")) {
                    if (reader.peek() != JsonToken.NUMBER || reader.nextDouble() != 1) throw new IllegalArgumentException();
                } else if (key.equals("values")) {
                    reader.beginObject(); Set<String> values = new HashSet<>();
                    while (reader.hasNext()) {
                        String name = reader.nextName(); if (!values.add(name)) throw new IllegalArgumentException();
                        if (name.equals("language") || name.equals("theme")) {
                            if (reader.peek() != JsonToken.STRING) throw new IllegalArgumentException();
                            String value = reader.nextString();
                            if (name.equals("language")) {
                                if (!Arrays.asList("pt-PT", "en-GB", "es-ES").contains(value)) throw new IllegalArgumentException();
                                language = value;
                            } else if (!Arrays.asList("light", "dark").contains(value)) throw new IllegalArgumentException();
                        } else if (Arrays.asList("glass", "largeText", "highContrast").contains(name)) {
                            if (reader.peek() != JsonToken.BOOLEAN) throw new IllegalArgumentException();
                            reader.nextBoolean();
                        } else throw new IllegalArgumentException();
                    }
                    reader.endObject();
                } else throw new IllegalArgumentException();
            }
            reader.endObject();
            if (keys.size() != 2 || reader.peek() != JsonToken.END_DOCUMENT) throw new IllegalArgumentException();
            return language;
        }
    }

    static String translate(String language, String source) {
        int column = language.equals("es-ES") ? 2 : language.equals("en-GB") ? 1 : 0;
        for (String[] row : TEXT) if (row[0].equals(source)) return row[column];
        return source;
    }

    private static final String[][] TEXT = {
        {"A preparar o teu nó neste dispositivo…", "Preparing your node on this device…", "Preparando tu nodo en este dispositivo…"},
        {"A iniciar a rede neste dispositivo…", "Starting the network on this device…", "Iniciando la red en este dispositivo…"},
        {"Não foi possível iniciar o nó neste dispositivo. Podes tentar novamente.", "Could not start the node on this device. You can try again.", "No se ha podido iniciar el nodo en este dispositivo. Puedes volver a intentarlo."},
        {"Tentar novamente", "Try again", "Volver a intentar"},
        {"Rede experimental. A retransmissão pára quando esta aplicação deixa de estar visível.", "Experimental network. Relaying stops when this app is no longer visible.", "Red experimental. La retransmisión se detiene cuando esta aplicación deja de estar visible."},
        {"Esta aplicação abre apenas a sua rede local.", "This app only opens its local network.", "Esta aplicación solo abre su red local."},
        {"Mensagens privadas", "Private messages", "Mensajes privados"},
        {"Avisos genéricos, sem nomes ou conteúdo de mensagens", "Generic alerts, without names or message content", "Avisos genéricos, sin nombres ni contenido de mensajes"},
        {"Tens novas mensagens privadas. Abre o RelayLoom para as ler.", "You have new private messages. Open RelayLoom to read them.", "Tienes nuevos mensajes privados. Abre RelayLoom para leerlos."},
        {"Escolha cancelada porque a sessão mudou.", "Selection cancelled because the session changed.", "Selección cancelada porque la sesión ha cambiado."},
        {"Escolha cancelada porque a aplicação deixou de estar activa.", "Selection cancelled because the app is no longer active.", "Selección cancelada porque la aplicación ha dejado de estar activa."},
        {"Escolha cancelada porque a aplicação fechou.", "Selection cancelled because the app closed.", "Selección cancelada porque la aplicación se ha cerrado."},
        {"A escolha de documento expirou após dois minutos. Tenta novamente.", "Document selection expired after two minutes. Try again.", "La selección de documento ha caducado tras dos minutos. Vuelve a intentarlo."},
        {"Não foi possível suspender a captura antes de abrir o documento.", "Could not pause capture before opening the document.", "No se ha podido pausar la captura antes de abrir el documento."},
        {"Não foi possível abrir o selector de documentos deste dispositivo.", "Could not open this device's document picker.", "No se ha podido abrir el selector de documentos de este dispositivo."},
        {"Activa a escolha a partir do botão de anexar ficheiro.", "Use the attach file button to select a document.", "Usa el botón de adjuntar archivo para seleccionar un documento."},
        {"A captura directa não está disponível aqui. Escolhe um ficheiro já guardado.", "Direct capture is unavailable here. Choose a saved file.", "La captura directa no está disponible aquí. Elige un archivo guardado."},
        {"Conclui ou cancela a escolha de documento em curso.", "Finish or cancel the current document selection.", "Termina o cancela la selección de documento en curso."},
        {"Activa a transferência a partir do respectivo botão na aplicação.", "Use the corresponding button in the app to start the download.", "Usa el botón correspondiente de la aplicación para iniciar la descarga."},
        {"O ficheiro excede o limite permitido ou tem codificação inválida.", "The file exceeds the allowed limit or has invalid encoding.", "El archivo supera el límite permitido o tiene una codificación no válida."},
        {"Transferência cancelada porque a sessão mudou.", "Download cancelled because the session changed.", "Descarga cancelada porque la sesión ha cambiado."},
        {"Não foi possível preparar o documento para guardar.", "Could not prepare the document for saving.", "No se ha podido preparar el documento para guardarlo."},
        {"A escolha já terminou ou expirou. Tenta novamente.", "The selection has already ended or expired. Try again.", "La selección ya ha terminado o caducado. Vuelve a intentarlo."},
        {"Escolha de documento cancelada. Nada foi guardado ou anexado.", "Document selection cancelled. Nothing was saved or attached.", "Selección de documento cancelada. No se ha guardado ni adjuntado nada."},
        {"O destino não concedeu um documento válido.", "The destination did not grant a valid document.", "El destino no ha concedido un documento válido."},
        {"O selector não concedeu um documento válido.", "The picker did not grant a valid document.", "El selector no ha concedido un documento válido."},
        {"Cada anexo pode ter até 2 MB.", "Each attachment can be up to 2 MB.", "Cada adjunto puede tener hasta 2 MB."},
        {"Ficheiros seleccionados. Conclui a mensagem na aplicação.", "Files selected. Complete the message in the app.", "Archivos seleccionados. Completa el mensaje en la aplicación."},
        {"Não foi possível ler o documento autorizado. Nenhum ficheiro foi anexado.", "Could not read the authorised document. No file was attached.", "No se ha podido leer el documento autorizado. No se ha adjuntado ningún archivo."},
        {"Ficheiro guardado no destino que escolheste.", "File saved to your chosen destination.", "Archivo guardado en el destino que has elegido."},
        {"A sessão mudou durante a gravação. O destino pode conter um ficheiro incompleto.", "The session changed while saving. The destination may contain an incomplete file.", "La sesión ha cambiado al guardar. El destino puede contener un archivo incompleto."},
        {"Não foi possível guardar o documento. O destino pode conter um ficheiro incompleto.", "Could not save the document. The destination may contain an incomplete file.", "No se ha podido guardar el documento. El destino puede contener un archivo incompleto."},
        {"A gravação foi interrompida. O destino pode conter um ficheiro incompleto.", "Saving was interrupted. The destination may contain an incomplete file.", "Se ha interrumpido el guardado. El destino puede contener un archivo incompleto."},
        {"Este tipo de ficheiro não é suportado. Usa imagem, áudio, vídeo, texto, JSON, PDF ou ZIP.", "This file type is not supported. Use an image, audio, video, text, JSON, PDF or ZIP file.", "Este tipo de archivo no es compatible. Usa una imagen, audio, vídeo, texto, JSON, PDF o ZIP."},
        {"Escolhe entre um e quatro ficheiros.", "Choose between one and four files.", "Elige entre uno y cuatro archivos."}
    };
}
