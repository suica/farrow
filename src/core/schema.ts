import { match as createMatch } from 'path-to-regexp'

type JsonType =
  | number
  | string
  | boolean
  | null
  | JsonType[]
  | {
      [key: string]: JsonType
    }

export type Type<T = any> = {
  (value: T): Term<T>
  toJSON: () => JsonType
  is: (term: Term) => term is Term<T>
  assert: (term: Term) => asserts term is Term<T>
  validate: (input: unknown) => Result<T>
  pipe: <R>(options: CreateTypeOptions<R, T>) => Type<R>
}

export type Term<T = any> = {
  kind: symbol
  value: T
}

export type RawType<T extends Type> = T extends Type<infer R> ? R : T

export type Err<T = any> = {
  kind: 'Err'
  value: T
  isErr: true
  isOk: false
}

export type Ok<T = any> = {
  kind: 'Ok'
  value: T
  isErr: false
  isOk: true
}

export type Result<T = any, E = string> = Err<E> | Ok<T>

export const Err = <T, E = string>(value: E): Result<T, E> => {
  let err: Err = {
    kind: 'Err',
    value,
    isErr: true,
    isOk: false,
  }
  return err
}

export const Ok = <T, E = string>(value: T): Result<T, E> => {
  let ok: Ok<T> = {
    kind: 'Ok',
    value,
    isErr: false,
    isOk: true,
  }
  return ok
}

export type CreateTypeOptions<T, I = unknown> = {
  toJSON: () => JsonType
  validate: (input: I) => Result<T>
}

export const createType = <T>(options: CreateTypeOptions<T>): Type<T> => {
  type Schema = Type<T>

  let symbol = Symbol('KIND')

  let validate: Schema['validate'] = options.validate

  let is = (input: Term): input is Term<T> => {
    return input.kind === symbol
  }

  let assert: Schema['assert'] = (input) => {
    if (!is(input)) {
      throw new Error(`Unexpected value: ${input}`)
    }
  }

  let pipe: Schema['pipe'] = (options) => {
    return createType({
      toJSON: options.toJSON,
      validate: (input) => {
        let result = validate(input)
        if (result.isErr) return result
        return options.validate(result.value)
      },
    })
  }

  let json: JsonType | undefined

  let props = {
    toJSON: () => {
      if (json === undefined) {
        json = options.toJSON()
      }
      return json
    },
    validate,
    is,
    assert,
    pipe,
  }

  let schema: Schema = Object.assign((value: T) => {
    let result = validate(value)
    if (result.isErr) {
      throw new Error(result.value)
    }
    return {
      kind: symbol,
      value: result.value,
    }
  }, props)

  return schema
}

export const is = <T>(input: Term, Type: Type<T>): input is Term<T> => {
  return Type.is(input)
}

export const thunk = <T>(f: () => Type<T>): Type<T> => {
  let Type: Type<T> | undefined

  let getType = () => {
    if (Type === undefined) {
      Type = f()
    }
    return Type
  }

  return createType<T>({
    toJSON: () => {
      return getType().toJSON()
    },
    validate: (input) => {
      return getType().validate(input)
    },
  })
}

// tslint:disable-next-line: variable-name
export const number = createType<number>({
  toJSON: () => {
    return 'number'
  },
  validate: (input) => {
    if (input === 'string') {
      let n = Number(input)
      if (!isNaN(n)) {
        input = n
      }
    }
    if (typeof input === 'number') {
      return Ok(input)
    } else {
      return Err(`${input} is not a number`)
    }
  },
})

// tslint:disable-next-line: variable-name
export const string = createType<string>({
  toJSON: () => {
    return 'string'
  },
  validate: (input) => {
    if (typeof input === 'string') {
      return Ok(input)
    } else {
      return Err(`${input} is not a string`)
    }
  },
})

// tslint:disable-next-line: variable-name
export const boolean = createType<boolean>({
  toJSON: () => {
    return 'boolean'
  },
  validate: (input) => {
    if (input === 'true') {
      input = true
    } else if (input === 'false') {
      input = false
    }
    if (typeof input === 'boolean') {
      return Ok(input)
    } else {
      return Err(`${input} is not a boolean`)
    }
  },
})

export const list = <T extends Type>(ItemType: T): Type<Array<RawType<T>>> => {
  type List = Array<RawType<T>>
  return createType<List>({
    toJSON: () => {
      return {
        type: 'List',
        itemType: ItemType.toJSON(),
      }
    },
    validate: (input) => {
      if (!Array.isArray(input)) {
        return Err(`${input} is not a array`)
      }

      let list: List = []

      for (let i = 0; i < input.length; i++) {
        let item = input[i]
        let result = ItemType.validate(item)
        if (result.isErr) return result
        list.push(result.value)
      }

      return Ok(list)
    },
  })
}

export type Fields = {
  [key: string]: Type
}

type RawFields<T extends Fields> = {
  [key in keyof T]: RawType<T[key]>
}

export const object = <T extends Fields>(
  fields: T
): Type<
  {
    [key in keyof T]: RawType<T[key]>
  }
> => {
  type ObjectType = RawFields<T>

  let Type: Type<ObjectType> = createType({
    toJSON: () => {
      let list = Object.entries(fields).map(([key, Type]) => {
        return {
          key,
          type: Type.toJSON(),
        }
      })
      return {
        type: 'Object',
        fields: list,
      }
    },
    validate: (input) => {
      if (typeof input !== 'object') {
        return Err(`${input} is not an object`)
      }

      if (input === null) {
        return Err(`null is not an object`)
      }

      if (Array.isArray(input)) {
        return Err(`${input} is not an object`)
      }

      let object = {} as any

      let source = input as Record<string, any>

      for (let key in fields) {
        let FieldType = fields[key]
        let field = source[key]
        let result = FieldType.validate(field)

        if (result.isErr) return result

        object[key] = result.value
      }

      return Ok(object as ObjectType)
    },
  })

  return Type
}

export const nullable = <T extends Type>(Type: T): Type<RawType<T> | null | undefined> => {
  return createType<RawType<T> | null | undefined>({
    toJSON: () => {
      return {
        type: 'Nullable',
        contentType: Type.toJSON(),
      }
    },
    validate: (input) => {
      if (input === null) {
        return Ok(input)
      }

      if (input === undefined) {
        return Ok(input)
      }

      return Type.validate(input)
    },
  })
}

type RawUnionItemType<T extends Type> = T extends Type ? RawType<T> : never

export const union = <T extends Type[]>(...Types: T): Type<RawUnionItemType<T[number]>> => {
  let Type: Type<RawUnionItemType<T[number]>> = createType({
    toJSON: () => {
      return {
        type: 'Union',
        contentTypes: Types.map((Type) => Type.toJSON()),
      }
    },
    validate: (input) => {
      let list: string[] = []
      for (let i = 0; i < Types.length; i++) {
        let Type = Types[i]
        let result = Type.validate(input)
        if (result.isOk) return result
        list.push(result.value)
      }
      return Err(`${input} is not the union type, messages:\n${list.join('\n')}`)
    },
  })

  return Type
}

export type LiteralType = string | number | boolean | null | undefined

export const literal = <T extends LiteralType>(literal: T): Type<T> => {
  return createType<T>({
    toJSON: () => {
      return {
        type: 'Literal',
        literal: literal as any,
      }
    },
    validate: (input) => {
      if (input === literal) {
        return Ok(literal)
      } else {
        return Err(`${input} is not equal to ${literal}`)
      }
    },
  })
}

export const record = <T extends Type>(Type: T): Type<Record<string, RawType<T>>> => {
  let ResultType: Type<Record<string, RawType<T>>> = createType({
    toJSON: () => {
      return {
        type: 'Record',
        valueType: Type.toJSON(),
      }
    },
    validate: (input) => {
      if (typeof input !== 'object') {
        return Err(`${input} is not an object`)
      }

      if (input === null) {
        return Err(`null is not an object`)
      }

      if (Array.isArray(input)) {
        return Err(`${input} is not an object`)
      }

      let record = {} as Record<string, RawType<T>>

      let source = input as any

      for (let key in source) {
        let value = source[key]
        let result = Type.validate(value)
        if (result.isErr) return result
        record[key] = result.value
      }

      return Ok(record)
    },
  })

  return ResultType
}

export type Object = Type<Record<string, any>>

export type List = Type<any[]>

export const Pattern = <T>(pattern: string, ParamsType: Type<T>): Type<T> => {
  let match = createMatch(pattern)
  return string.pipe({
    toJSON: () => {
      return {
        type: 'Pattern',
        pattern: pattern,
        paramsType: ParamsType.toJSON(),
      }
    },
    validate: (path) => {
      let matches = match(path)
      if (!matches) {
        return Err(`${path} is not matched the pattern: ${pattern}`)
      }
      let params = matches.params
      return ParamsType.validate(params)
    },
  })
}

export const Json: Type<JsonType> = thunk(() => {
  return union(number, string, boolean, literal(null), list(Json), record(Json))
})

// tslint:disable-next-line: variable-name
export const any = createType<any>({
  toJSON: () => {
    return {
      type: 'Any',
    }
  },
  validate: (input) => {
    return Ok(input as any)
  },
})

const Home = Pattern(
  '/home',
  object({
    id: number,
  })
)

const home = Home.validate('/home')

const TestUnion = union(literal('1 as const'), literal(null))

const testUnion = TestUnion('1 as const')

const TestNullable = nullable(TestUnion)

const testNullable = TestNullable(null)

const Todo = object({
  id: number,
  content: string,
  completed: boolean,
})

let n = number(1)

const Todos = list(Todo)

const Header = object({
  text: string,
})

const Footer = object({
  filterType: string,
})

const AppState = object({
  header: Header,
  todos: Todos,
  footer: Footer,
})

const todos = Todos([
  {
    id: 0,
    content: '0',
    completed: false,
  },
  {
    id: 1,
    content: '1',
    completed: false,
  },
  {
    id: 2,
    content: '2',
    completed: false,
  },
])