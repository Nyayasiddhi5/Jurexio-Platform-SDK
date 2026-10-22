import type { cv } from "../cv-provider.js";
import type { OperationFunction, OperationName, OperationOptions, OperationResult } from "./index.js";
/**
 * Registry that maps operation names to their implementation functions and
 * default-option factories. Operation files call {@link OperationRegistry.register}
 * at module-load time to make themselves available to {@link executeOperation}.
 */
export declare class OperationRegistry {
    private operations;
    private defaultOptions;
    /**
     * Register a named operation.
     * @param name Unique operation name (must match a key in {@link RegisteredOperations}).
     * @param operation The function that performs the operation.
     * @param defaultOptions Optional factory returning default option values.
     */
    register<Name extends OperationName>(name: Name, operation: OperationFunction<OperationOptions<Name>>, defaultOptions?: () => Partial<OperationOptions<Name>>): void;
    /** Look up the implementation for an operation by name. */
    getOperation(name: string): OperationFunction<any> | undefined;
    /** Return the default-options factory for an operation, or an empty object if none was registered. */
    getDefaultOptionsGenerator(name: string): any;
    /** Return `true` if an operation with the given name has been registered. */
    hasOperation(name: string): boolean;
    /** Return the names of all registered operations. */
    getOperationNames(): OperationName[];
}
/** Singleton registry populated by each `src/operations/*.ts` module at load time. */
export declare const registry: OperationRegistry;
/**
 * Look up and execute a registered operation, merging caller-supplied options
 * with the operation's defaults.
 *
 * @param operationName Name of the registered operation.
 * @param img Input OpenCV Mat. The Mat is consumed (deleted) by the operation.
 * @param options Partial options to merge with the operation's defaults.
 * @returns The operation result containing the transformed Mat and its dimensions.
 * @throws {Error} If no operation with `operationName` is registered.
 */
export declare function executeOperation<Name extends OperationName>(operationName: Name, img: cv.Mat, options?: Partial<OperationOptions<Name>>): OperationResult;
