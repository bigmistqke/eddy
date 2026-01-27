export function pick<T extends object, U extends Array<keyof T>>(value: T, keys: U): Pick<T, U[number]> {
    return keys.reduce((agg, key) => ({ ...agg, [key]: value[key] }), {} as Pick<T, U[number]>)
}