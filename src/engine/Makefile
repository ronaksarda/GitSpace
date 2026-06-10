CXX = g++
CXXFLAGS = -O3 -std=c++17 -Wall -Wextra -Wpedantic
TARGET = gitland_engine.exe

all: $(TARGET)

$(TARGET): main.cpp SpatialEngine.h
	$(CXX) $(CXXFLAGS) main.cpp -o $(TARGET)

clean:
	rm -f $(TARGET)
