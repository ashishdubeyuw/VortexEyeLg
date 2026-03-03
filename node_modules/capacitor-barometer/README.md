# capacitor-barometer

Capacitor-Barometer is a native plugin for Capacitor that provides access to barometric pressure sensor data on supported devices. Easily integrate real-time atmospheric pressure readings into your cross-platform mobile apps for weather tracking, altitude estimation, or scientific applications.

## Install

```bash
npm install capacitor-barometer
npx cap sync
```

## API

<docgen-index>

* [`isAvailable()`](#isavailable)
* [`start()`](#start)
* [`stop()`](#stop)
* [`getPressure()`](#getpressure)
* [`echo(...)`](#echo)
* [`addListener('onPressureChange', ...)`](#addlisteneronpressurechange-)
* [`removeAllListeners()`](#removealllisteners)
* [Interfaces](#interfaces)

</docgen-index>

<docgen-api>
<!--Update the source file JSDoc comments and rerun docgen to update the docs below-->

### isAvailable()

```typescript
isAvailable() => Promise<{ available: boolean; }>
```

Checks if the barometer sensor is available on the device.

**Returns:** <code>Promise&lt;{ available: boolean; }&gt;</code>

--------------------


### start()

```typescript
start() => Promise<void>
```

Starts listening for barometer updates.
This will also trigger the 'onPressureChange' event.

--------------------


### stop()

```typescript
stop() => Promise<void>
```

Stops listening for barometer updates.

--------------------


### getPressure()

```typescript
getPressure() => Promise<{ pressure: number; }>
```

Gets the last known pressure reading.
Ensure 'start()' has been called and data is available.

**Returns:** <code>Promise&lt;{ pressure: number; }&gt;</code>

--------------------


### echo(...)

```typescript
echo(options: { value: string; }) => Promise<{ value: string; }>
```

An echo method for testing.

| Param         | Type                            |
| ------------- | ------------------------------- |
| **`options`** | <code>{ value: string; }</code> |

**Returns:** <code>Promise&lt;{ value: string; }&gt;</code>

--------------------


### addListener('onPressureChange', ...)

```typescript
addListener(eventName: 'onPressureChange', listenerFunc: (data: { pressure: number; }) => void) => Promise<PluginListenerHandle> & PluginListenerHandle
```

Called when pressure data changes.

| Param              | Type                                                  | Description                                |
| ------------------ | ----------------------------------------------------- | ------------------------------------------ |
| **`eventName`**    | <code>'onPressureChange'</code>                       | The name of the event ('onPressureChange') |
| **`listenerFunc`** | <code>(data: { pressure: number; }) =&gt; void</code> | The callback function to be executed.      |

**Returns:** <code>Promise&lt;<a href="#pluginlistenerhandle">PluginListenerHandle</a>&gt; & <a href="#pluginlistenerhandle">PluginListenerHandle</a></code>

--------------------


### removeAllListeners()

```typescript
removeAllListeners() => Promise<void>
```

Removes all listeners for this plugin.

--------------------


### Interfaces


#### PluginListenerHandle

| Prop         | Type                                      |
| ------------ | ----------------------------------------- |
| **`remove`** | <code>() =&gt; Promise&lt;void&gt;</code> |

</docgen-api>
