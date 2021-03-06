import { createServerBundler } from './bundler/server'
import { getConfig, GetConfigOptions } from './config'

export default async function start(options: GetConfigOptions) {
  let config = await getConfig(options)

  let serverBundler = createServerBundler({
    minify: true,
    env: {
      NODE_ENV: 'production',
    },
    ...config.server,
  })

  await serverBundler.start({
    run: true,
  })
}
