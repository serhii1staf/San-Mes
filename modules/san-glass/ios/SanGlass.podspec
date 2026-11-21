Pod::Spec.new do |s|
  s.name           = 'SanGlass'
  s.version        = '1.0.0'
  s.summary        = "San's own liquid glass."
  s.description    = 'What is behind a view, bent at its rim with the glisse lens, drawn with Metal.'
  s.license        = 'UNLICENSED'
  s.author         = 'San'
  s.homepage       = 'https://san-m-app.com'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/serhii1staf/San-Mes.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Metal', 'MetalPerformanceShaders', 'QuartzCore', 'CoreVideo', 'UIKit'

  s.source_files = '**/*.{h,m,swift}'
end
