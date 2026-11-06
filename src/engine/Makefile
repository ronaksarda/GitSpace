CXX = g++
CXXFLAGS = -O3 -std=c++17 -Wall -Wextra -Wpedantic
# api.js looks for gitspace_engine (gitspace_engine.exe on Windows)
TARGET = gitspace_engine$(if $(filter Windows_NT,$(OS)),.exe,)

all: $(TARGET)

$(TARGET): main.cpp SpatialEngine.h
	$(CXX) $(CXXFLAGS) main.cpp -o $(TARGET)

clean:
	rm -f $(TARGET)
