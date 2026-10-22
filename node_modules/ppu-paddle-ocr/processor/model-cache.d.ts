/** On-disk directory for cached model and dictionary files. */
export declare const CACHE_DIR: string;
/**
 * Cache path for `url`: the file name under a directory named after a digest
 * of the whole URL.
 *
 * The digest is what keeps two resources that share a file name apart. Model
 * file names repeat across hosts and directories, so keying on the name alone
 * would serve one URL's bytes for another's request - a custom model shadowed
 * by a preset, or a host swap that silently keeps reading the old host's copy.
 */
export declare function cachePathFor(url: string): string;
/**
 * Downloads a resource from `url` and writes it to {@link CACHE_DIR}, or reads
 * from the cache if the file already exists.
 */
export declare function fetchAndCacheResource(url: string, verbose?: boolean): Promise<ArrayBuffer>;
